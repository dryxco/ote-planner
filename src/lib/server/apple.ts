// Apple iCloud Calendar (read-only) over CalDAV with an app-specific password.
import { createHash } from "node:crypto";
import { DAVClient, type DAVCalendar } from "tsdav";
import type { CalendarEvent, CalendarInfo } from "../types";
import { fetchWithTimeout, networkReason, ProviderError } from "./http";
import { icsToEvents, type Range } from "./ics";
import type { AppleAccountRecord } from "./store";

const ICLOUD_CALDAV = "https://caldav.icloud.com";
const DEFAULT_COLOR = "#ff2d55";
const CLIENT_TTL_MS = 10 * 60_000;

export const CHECK_PASSWORD = "Check app-specific password";

export function appleAccountId(appleId: string): string {
  return createHash("sha256").update(appleId.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/** Translate tsdav / fetch failures into a reason the user can act on. */
export function appleError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const net = networkReason(err);
  if (net) return new ProviderError(`Can't reach iCloud (${net})`);
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|Unauthorized|Invalid credentials/i.test(msg)) {
    return new ProviderError(
      `${CHECK_PASSWORD}: the Apple ID or app-specific password is wrong or was revoked. Create a new one at appleid.apple.com > Sign-In and Security > App-Specific Passwords (your regular Apple ID password won't work)`,
      true,
    );
  }
  if (/403|Forbidden/i.test(msg)) {
    return new ProviderError("iCloud denied calendar access (check that iCloud Calendar is on and the account is in good standing)");
  }
  if (/cannot find (principalUrl|homeUrl)/i.test(msg)) {
    return new ProviderError("iCloud Calendar account not found (check that iCloud Calendar is on for this Apple ID)");
  }
  if (/5\d\d/.test(msg)) return new ProviderError("iCloud server error — try again shortly");
  return new ProviderError(`iCloud Calendar request failed: ${msg.slice(0, 200)}`);
}

interface Session {
  at: number;
  password: string;
  client: DAVClient;
  calendars: DAVCalendar[];
}

const sessions = new Map<string, Promise<Session>>();

async function login(appleId: string, appPassword: string): Promise<Session> {
  const client = new DAVClient({
    serverUrl: ICLOUD_CALDAV,
    credentials: { username: appleId, password: appPassword },
    authMethod: "Basic",
    defaultAccountType: "caldav",
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => fetchWithTimeout(input, init, 20_000)) as typeof fetch,
  });
  try {
    await client.login();
    const all = await client.fetchCalendars();
    const calendars = all.filter((c) => !c.components?.length || c.components.includes("VEVENT"));
    return { at: Date.now(), password: appPassword, client, calendars };
  } catch (err) {
    throw appleError(err);
  }
}

/** Validate credentials by CalDAV discovery. Throws ProviderError with a clear reason. */
export async function verifyApple(appleId: string, appPassword: string): Promise<number> {
  const s = await login(appleId, appPassword);
  sessions.set(appleAccountId(appleId), Promise.resolve(s));
  return s.calendars.length;
}

function session(acc: AppleAccountRecord): Promise<Session> {
  const existing = sessions.get(acc.accountId);
  if (existing) {
    return existing.then(
      (s) => (Date.now() - s.at < CLIENT_TTL_MS && s.password === acc.appPassword ? s : fresh()),
      () => fresh(),
    );
  }
  return fresh();

  function fresh(): Promise<Session> {
    const p = login(acc.appleId, acc.appPassword);
    sessions.set(acc.accountId, p);
    p.catch(() => sessions.delete(acc.accountId));
    return p;
  }
}

export function dropAppleSession(accountId: string): void {
  sessions.delete(accountId);
}

function normalizeColor(c: string | undefined): string {
  if (!c) return DEFAULT_COLOR;
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c.trim());
  return m ? `#${m[1].toLowerCase()}` : DEFAULT_COLOR;
}

function calendarKey(url: string): string {
  // iCloud calendar URLs look like https://pXX-caldav.icloud.com/<dsid>/calendars/<guid>/
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] ?? url);
}

function toInfo(acc: AppleAccountRecord, c: DAVCalendar): CalendarInfo {
  return {
    id: `apple:${acc.accountId}:${calendarKey(c.url)}`,
    provider: "apple",
    accountId: acc.accountId,
    name: typeof c.displayName === "string" && c.displayName.trim() ? c.displayName : "iCloud Calendar",
    color: normalizeColor(c.calendarColor),
  };
}

export async function listAppleCalendars(acc: AppleAccountRecord): Promise<CalendarInfo[]> {
  const s = await session(acc);
  return s.calendars.map((c) => toInfo(acc, c));
}

export async function listAppleEvents(
  acc: AppleAccountRecord,
  range: Range,
  tz?: string,
): Promise<{ events: CalendarEvent[]; errors: string[] }> {
  const s = await session(acc);
  const events: CalendarEvent[] = [];
  const errors: string[] = [];
  const timeRange = { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() };
  await Promise.all(
    s.calendars.map(async (c) => {
      const info = toInfo(acc, c);
      try {
        // Fetch raw objects overlapping the range and expand RRULEs locally (iCloud's
        // server-side <expand> is unreliable for overrides and time zones).
        const objects = await s.client.fetchCalendarObjects({ calendar: c, timeRange });
        events.push(...icsToEvents(objects.map((o) => (typeof o.data === "string" ? o.data : "")), info, range, tz));
      } catch (err) {
        const e = appleError(err);
        if (e.needsReconnect) throw e;
        errors.push(`${info.name}: ${e.message}`);
      }
    }),
  );
  return { events, errors };
}
