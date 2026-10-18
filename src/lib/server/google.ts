// Google Calendar (read-only) via plain REST + OAuth 2.0 authorization code flow.
import { createHash, randomBytes } from "node:crypto";
import type { CalendarEvent, CalendarInfo } from "../types";
import { appUrl, fetchWithTimeout, networkReason, ProviderError } from "./http";
import type { Range } from "./ics";
import { getStore, updateStore, type GoogleAccountRecord } from "./store";
import { dateStringToMidnight } from "./time";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const SCOPES = ["openid", "email", CALENDAR_SCOPE].join(" ");
const DEFAULT_COLOR = "#4285f4";
const DAY_MS = 86_400_000;

export const RECONNECT = "Reconnect your Google account";
export const OAUTH_COOKIE = "sync_google_oauth";

function clientCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    throw new ProviderError("Google integration isn't configured: the server needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars");
  }
  return { id, secret };
}

export function redirectUri(): string {
  return `${appUrl()}/api/auth/google/callback`;
}

// ---- OAuth ----

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(state: string, codeChallenge: string): string {
  const { id } = clientCreds();
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = clientCreds();
  let res: Response;
  try {
    res = await fetchWithTimeout(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
    });
  } catch (err) {
    throw new ProviderError(`Can't reach Google sign-in (${networkReason(err) ?? "network error"})`);
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error) {
    switch (body.error) {
      case "invalid_grant":
        throw new ProviderError(`${RECONNECT} (token expired or access revoked)`, true);
      case "invalid_client":
      case "unauthorized_client":
        throw new ProviderError("Google OAuth client misconfigured: check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
      case "redirect_uri_mismatch":
        throw new ProviderError(`Google OAuth redirect URI mismatch: register ${redirectUri()} in Google Cloud Console`);
      default:
        throw new ProviderError(`Google token request failed (HTTP ${res.status}${body.error ? `, ${body.error}` : ""})`);
    }
  }
  return body;
}

function decodeIdToken(idToken: string): { sub?: string; email?: string } {
  // Received directly from Google's token endpoint over TLS, so signature verification
  // is not required (OIDC Core 3.1.3.7).
  try {
    const payload = idToken.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/** Exchange an authorization code and upsert the account. Returns the account id. */
export async function completeOAuth(code: string, verifier: string): Promise<string> {
  const tok = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri(),
  });
  if (!tok.access_token) throw new ProviderError("Google token response has no access_token");
  const granted = (tok.scope ?? "").split(/\s+/);
  if (!granted.includes(CALENDAR_SCOPE)) {
    throw new ProviderError("Google Calendar read access wasn't granted. Reconnect and check the calendar access permission");
  }
  const { sub, email } = tok.id_token ? decodeIdToken(tok.id_token) : {};
  if (!sub) throw new ProviderError("Couldn't identify the Google account (no id_token)");

  return updateStore((store) => {
    const existing = store.google.find((a) => a.accountId === sub);
    const refreshToken = tok.refresh_token ?? existing?.refreshToken;
    if (!refreshToken) {
      throw new ProviderError("Google didn't issue a refresh token. Remove the app at myaccount.google.com/permissions, then reconnect");
    }
    const record: GoogleAccountRecord = {
      accountId: sub,
      email: email ?? existing?.email ?? sub,
      accessToken: tok.access_token!,
      refreshToken,
      expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
      scope: tok.scope ?? "",
      connectedAt: existing?.connectedAt ?? Date.now(),
    };
    store.google = [...store.google.filter((a) => a.accountId !== sub), record];
    return sub;
  });
}

const refreshing = new Map<string, Promise<string>>();

async function refreshAccessToken(accountId: string): Promise<string> {
  const store = await getStore();
  const acc = store.google.find((a) => a.accountId === accountId);
  if (!acc) throw new ProviderError("Google account was disconnected");
  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: acc.refreshToken });
  if (!tok.access_token) throw new ProviderError(`${RECONNECT} (couldn't get a new access token)`, true);
  await updateStore((s) => {
    const a = s.google.find((x) => x.accountId === accountId);
    if (!a) return;
    a.accessToken = tok.access_token!;
    a.expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000;
    if (tok.refresh_token) a.refreshToken = tok.refresh_token;
  });
  return tok.access_token;
}

async function accessToken(acc: GoogleAccountRecord, force = false): Promise<string> {
  if (!force && acc.expiresAt - 60_000 > Date.now()) {
    // Re-read in case another request refreshed it already.
    const fresh = (await getStore()).google.find((a) => a.accountId === acc.accountId);
    if (fresh && fresh.expiresAt - 60_000 > Date.now()) return fresh.accessToken;
  }
  let p = refreshing.get(acc.accountId);
  if (!p) {
    p = refreshAccessToken(acc.accountId).finally(() => refreshing.delete(acc.accountId));
    refreshing.set(acc.accountId, p);
  }
  return p;
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetchWithTimeout(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }, 10_000);
  } catch {
    // Best effort; the local credentials are removed regardless.
  }
}

// ---- REST ----

interface GoogleApiError {
  error?: { code?: number; message?: string; errors?: { reason?: string }[]; status?: string };
}

async function apiGet<T>(acc: GoogleAccountRecord, path: string, params: Record<string, string>): Promise<T> {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(acc, attempt > 0);
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      throw new ProviderError(`Can't reach Google Calendar (${networkReason(err) ?? "network error"})`);
    }
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => ({}))) as GoogleApiError;
    const reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? "";
    if (res.status === 401 && attempt === 0) continue; // token rejected early: refresh once
    if (res.status === 401) throw new ProviderError(`${RECONNECT} (authentication rejected)`, true);
    if (res.status === 403 || res.status === 429) {
      if (/insufficientPermissions|PERMISSION_DENIED|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason)) {
        throw new ProviderError(`${RECONNECT} (no calendar read access — grant it when reconnecting)`, true);
      }
      if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(body.error?.message ?? "")) {
        throw new ProviderError("Google Calendar API isn't enabled in the Google Cloud project");
      }
      if (/rateLimit|userRateLimit|quota|RESOURCE_EXHAUSTED/i.test(reason) || res.status === 429) {
        throw new ProviderError("Google API rate limit hit — try again shortly");
      }
    }
    if (res.status === 404) throw new ProviderError("Google calendar not found (deleted or unsubscribed)");
    throw new ProviderError(`Google Calendar request failed (HTTP ${res.status}${reason ? `, ${reason}` : ""})`);
  }
  throw new ProviderError(RECONNECT, true);
}

interface CalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
}

export async function listGoogleCalendars(acc: GoogleAccountRecord): Promise<CalendarInfo[]> {
  const out: CalendarInfo[] = [];
  let pageToken: string | undefined;
  do {
    const page = await apiGet<{ items?: CalendarListEntry[]; nextPageToken?: string }>(acc, "/users/me/calendarList", {
      maxResults: "250",
      fields: "items(id,summary,summaryOverride,backgroundColor),nextPageToken",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const c of page.items ?? []) {
      out.push({
        id: `google:${acc.accountId}:${c.id}`,
        provider: "google",
        accountId: acc.accountId,
        name: c.summaryOverride || c.summary || c.id,
        color: c.backgroundColor || DEFAULT_COLOR,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

interface GTime {
  date?: string;
  dateTime?: string;
}

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GTime;
  end?: GTime;
  recurringEventId?: string;
  originalStartTime?: GTime;
  eventType?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
}

function gTimeToMs(t: GTime | undefined, tz?: string): number {
  if (!t) return NaN;
  if (t.dateTime) return Date.parse(t.dateTime);
  if (t.date) return dateStringToMidnight(t.date, tz);
  return NaN;
}

function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const s = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
  return s || undefined;
}

export function mapGoogleEvent(ev: GEvent, cal: CalendarInfo, tz?: string): CalendarEvent | null {
  if (ev.status === "cancelled") return null;
  if (ev.eventType === "workingLocation") return null;
  if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const allDay = !!ev.start?.date && !ev.start?.dateTime;
  const start = gTimeToMs(ev.start, tz);
  let end = gTimeToMs(ev.end, tz);
  if (!Number.isFinite(start)) return null;
  if (!Number.isFinite(end) || end < start) end = allDay ? start + DAY_MS : start;
  const occ = ev.originalStartTime ? gTimeToMs(ev.originalStartTime, tz) : start;
  const key = Number.isFinite(occ) ? occ : start;
  return {
    id: `${cal.id}:${ev.recurringEventId ?? ev.id}:${key}`,
    calendarId: cal.id,
    provider: "google",
    title: ev.summary?.trim() || "(No title)",
    start,
    end,
    allDay,
    location: ev.location?.trim() || undefined,
    notes: plainText(ev.description),
    color: cal.color,
  };
}

/** Events for one calendar, recurring events expanded server-side (singleEvents=true). */
export async function listGoogleEvents(
  acc: GoogleAccountRecord,
  cal: CalendarInfo,
  range: Range,
  tz?: string,
): Promise<CalendarEvent[]> {
  const calendarId = cal.id.slice(`google:${acc.accountId}:`.length);
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await apiGet<{ items?: GEvent[]; nextPageToken?: string }>(
      acc,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        singleEvents: "true",
        orderBy: "startTime",
        // Pad by a day: Google filters all-day events in the calendar's zone, not ours.
        timeMin: new Date(range.start - DAY_MS).toISOString(),
        timeMax: new Date(range.end + DAY_MS).toISOString(),
        maxResults: "2500",
        fields:
          "items(id,status,summary,description,location,start,end,recurringEventId,originalStartTime,eventType,attendees(self,responseStatus)),nextPageToken",
        ...(pageToken ? { pageToken } : {}),
      },
    );
    for (const ev of page.items ?? []) {
      const mapped = mapGoogleEvent(ev, cal, tz);
      if (mapped && mapped.start < range.end && (mapped.end > range.start || mapped.start >= range.start)) out.push(mapped);
    }
    pageToken = page.nextPageToken;
  } while (pageToken && ++pages < 20);
  return out;
}
