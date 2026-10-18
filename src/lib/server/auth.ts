// Sign-in for Ote.
//
// - Every page and API needs a Ote session (cookie). Two ways to get one:
//   * the password in OTE_PASSWORD (single user), or
//   * a device-code sign-in with a server of your own (OTE_LOGIN_URL, connectors/index.ts) whose
//     user id / email is on OTE_ALLOWED_USERS. Ote keeps no access to that server afterwards.
//   Neither configured = nobody can sign in from another device (fails closed).
// - This computer needs no sign-in when the server listens on it alone (OTE_BIND=127.0.0.1, which
//   scripts/serve.mjs sets with -H): then only this computer and `tailscale serve` can connect, and
//   what `tailscale serve` relays carries Tailscale-User-Login / a non-loopback X-Forwarded-For. On any
//   other bind address a request from the network could forge those headers (Next only fills in
//   X-Forwarded-For when it's missing), so every request needs a session there.
//   OTE_AUTH=off turns the gate off altogether — only for a server nobody else can reach.
// - Optional extra gate: if OTE_ALLOWED_TAILSCALE_USERS is set, requests through `tailscale serve`
//   must come from one of those Tailscale logins.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { shared } from "./shared";

export const SESSION_COOKIE = "ote_session";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const LOGIN_COOKIE = "ote_login";
export const SESSION_TTL_MS = 180 * 24 * 3600_000; // ~6 months

export interface Session {
  /** "password" for the OTE_PASSWORD login, else the id the sign-in server gave. */
  userId: string;
  method: "password" | "device";
  email: string | null;
  createdAt: number;
  expiresAt: number;
  /** Tailscale login used when the session was created (null = local access on this Mac). */
  tailscaleLogin: string | null;
}

function dataDir() {
  return process.env.OTE_DATA_DIR || path.join(process.cwd(), ".data");
}
const sessionsFile = () => path.join(dataDir(), "sessions.json");
const hashId = (id: string) => createHash("sha256").update(`sync-session:v1:${id}`).digest("hex");

function list(env: string | undefined): string[] {
  return (env ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const allowedUsers = () => list(process.env.OTE_ALLOWED_USERS);
export const allowedTailscale = () => list(process.env.OTE_ALLOWED_TAILSCALE_USERS);

export const authOff = () => process.env.OTE_AUTH === "off";

/** The server accepts connections from this computer only (see the top of this file). */
export const boundToLoopback = () => ["127.0.0.1", "localhost", "::1"].includes((process.env.OTE_BIND ?? "").trim());

/** A request made on this computer, when that can be told for sure: no sign-in needed. */
export function isLocalRequest(headers: Headers): boolean {
  if (!boundToLoopback() || headers.has("tailscale-user-login")) return false;
  return (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .every((ip) => !ip || LOOPBACK.has(ip));
}
export const passwordLogin = () => !!process.env.OTE_PASSWORD;

/** Constant-time check of the OTE_PASSWORD login. */
export function checkPassword(given: string): boolean {
  const want = process.env.OTE_PASSWORD;
  if (!want) return false;
  const h = (x: string) => createHash("sha256").update(x).digest();
  return timingSafeEqual(h(given), h(want));
}

export function isAllowedUser(userId: string, email: string | null): boolean {
  const allow = allowedUsers();
  return allow.includes(userId.toLowerCase()) || (!!email && allow.includes(email.toLowerCase()));
}

/**
 * Tailscale gate. Returns null when allowed, else a reason.
 * `tailscale serve` sets Tailscale-User-Login (overwriting anything the client sent) and
 * X-Forwarded-For; a direct local request to 127.0.0.1 has neither.
 */
export function tailscaleGate(headers: Headers): string | null {
  if (allowedTailscale().length === 0) return null; // not configured: the sign-in alone decides
  const login = headers.get("tailscale-user-login")?.toLowerCase() ?? null;
  // Next adds X-Forwarded-For itself with the socket address (loopback for local requests);
  // `tailscale serve` forwards the tailnet client's address. Any non-loopback hop = came in from outside.
  const proxied = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .some((ip) => ip && !LOOPBACK.has(ip));
  if (!login) {
    return proxied ? "Access isn't allowed from devices without a Tailscale user (e.g. tagged devices)" : null;
  }
  return allowedTailscale().includes(login) ? null : `This Tailscale account (${login}) isn't allowed`;
}

// ---- session store (.data/sessions.json, keyed by hash of the cookie value) ----

type SessionMap = Record<string, Session>;
let cache: { mtimeMs: number; map: SessionMap } | null = null;

/** Synchronous read with an mtime cache (used by the request proxy on every request). */
function readSessionsSync(): SessionMap {
  try {
    const st = statSync(sessionsFile());
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.map;
    const map = JSON.parse(readFileSync(sessionsFile(), "utf8")) as SessionMap;
    cache = { mtimeMs: st.mtimeMs, map };
    return map;
  } catch {
    return {};
  }
}

const sessionWrites = shared("auth.writeQueue", () => ({ queue: Promise.resolve() as Promise<unknown> }));
function mutateSessions(fn: (m: SessionMap) => void): Promise<void> {
  const run = async () => {
    const map = { ...readSessionsSync() };
    fn(map);
    const now = Date.now();
    for (const [k, s] of Object.entries(map)) if (s.expiresAt <= now) delete map[k];
    await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 });
    const tmp = `${sessionsFile()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(map), { mode: 0o600 });
    await fs.rename(tmp, sessionsFile());
    cache = null;
  };
  const next = sessionWrites.queue.then(run, run);
  sessionWrites.queue = next.catch(() => {});
  return next;
}

export function getSession(cookieValue: string | undefined | null): Session | null {
  if (!cookieValue || cookieValue.length < 20 || cookieValue.length > 200) return null;
  const s = readSessionsSync()[hashId(cookieValue)];
  if (!s || s.expiresAt <= Date.now()) return null;
  // re-checked on every request, so removing someone (or the password) takes effect at once
  if (s.method === "password" ? !passwordLogin() : !isAllowedUser(s.userId, s.email)) return null;
  return s;
}

export async function createSession(s: Omit<Session, "createdAt" | "expiresAt">): Promise<{ id: string; session: Session }> {
  const id = randomBytes(32).toString("base64url");
  const now = Date.now();
  const session: Session = { ...s, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  await mutateSessions((m) => {
    m[hashId(id)] = session;
  });
  return { id, session };
}

export async function deleteSession(cookieValue: string | undefined | null) {
  if (!cookieValue) return;
  await mutateSessions((m) => {
    delete m[hashId(cookieValue)];
  });
}

export function cookieOptions(request: Request, maxAgeSec: number) {
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: proto === "https",
    path: "/",
    maxAge: maxAgeSec,
  };
}

export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** For tests: create a session without signing in (only usable by code with file access). */
export const _testing = { hashId, sessionsFile };
