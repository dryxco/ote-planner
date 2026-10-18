// Calendars subscribed by iCal link (Google "secret address in iCal format", iCloud public
// calendars, Outlook ICS links, ...). Read-only; the whole feed is fetched and expanded locally.
import { createHash } from "node:crypto";
import type { CalendarEvent, CalendarInfo } from "../types";
import { fetchWithTimeout, networkReason, ProviderError } from "./http";
import { icsToEvents, type Range } from "./ics";
import type { IcsSubscriptionRecord } from "./store";

const FEED_TTL_MS = 5 * 60_000;
const MAX_BYTES = 15 * 1024 * 1024;
const feeds = new Map<string, { at: number; text: string }>();

/** Normalize and vet a user-supplied feed URL (https only, no local/private hosts). */
export function normalizeIcsUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    throw new ProviderError("Not a valid address (use an iCal URL starting with https:// or webcal://)");
  }
  if (u.protocol !== "https:") throw new ProviderError("Only https addresses are supported");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "[::1]") {
    throw new ProviderError("Internal network addresses aren't allowed");
  }
  return u.toString();
}

export const icsAccountId = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 16);

export function icsCalendarInfo(sub: IcsSubscriptionRecord): CalendarInfo {
  return { id: `ics:${sub.accountId}:feed`, provider: "ics", accountId: sub.accountId, name: sub.name, color: sub.color };
}

export async function fetchFeed(url: string, fresh = false): Promise<string> {
  const hit = feeds.get(url);
  if (!fresh && hit && Date.now() - hit.at < FEED_TTL_MS) return hit.text;
  let r: Response;
  try {
    r = await fetchWithTimeout(url, { headers: { accept: "text/calendar, */*" }, redirect: "follow" }, 20_000);
  } catch (e) {
    throw new ProviderError(`Couldn't reach the calendar address (${networkReason(e) ?? (e as Error).message})`);
  }
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    throw new ProviderError(`Calendar address is no longer valid (HTTP ${r.status}) — check whether the secret address was reset`, true);
  }
  if (!r.ok) throw new ProviderError(`Couldn't fetch the calendar (HTTP ${r.status})`);
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new ProviderError("Calendar file is too large");
  if (text.trim() === "forbidden") throw new ProviderError("The key in the Apps Script URL doesn't match the script's KEY");
  if (/^Your calendars:/.test(text)) throw new ProviderError("The Apps Script URL is missing &cal=… — append the calendar's cal= value from the list");
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new ProviderError("Not an iCal (.ics) feed — make sure you copied the 'Secret address in iCal format'");
  feeds.set(url, { at: Date.now(), text });
  return text;
}

/** Calendar name and color declared in the feed, if any. */
export function feedMeta(text: string): { name: string | null; color: string | null } {
  const unfold = text.replace(/\r?\n[ \t]/g, "");
  const name = /^X-WR-CALNAME[^:]*:(.+)$/im.exec(unfold)?.[1]?.trim() ?? null;
  const color = /^X-APPLE-CALENDAR-COLOR[^:]*:(#[0-9a-f]{6})/im.exec(unfold)?.[1] ?? null;
  return { name: name ? name.replace(/\\,/g, ",").replace(/\;/g, ";") : null, color };
}

export async function listIcsEvents(sub: IcsSubscriptionRecord, range: Range, tz?: string): Promise<CalendarEvent[]> {
  return icsToEvents(await fetchFeed(sub.url), icsCalendarInfo(sub), range, tz);
}

export function dropFeed(url: string) {
  feeds.delete(url);
}
