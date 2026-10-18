import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS, checkPassword, cookieOptions, createSession, passwordLogin } from "@/lib/server/auth";
import { checkSameOrigin, readJson } from "@/lib/server/http";

// a wrong password slows the next attempts down (process memory; a restart resets it)
const g = globalThis as unknown as { __pwFails?: { n: number; until: number } };

/** POST {password} — sign in with SYNC_PASSWORD. */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  if (!passwordLogin()) return NextResponse.json({ error: "Password sign-in isn't set up (SYNC_PASSWORD)" }, { status: 404 });
  const f = (g.__pwFails ??= { n: 0, until: 0 });
  if (Date.now() < f.until) return NextResponse.json({ error: "Too many tries. Wait a moment" }, { status: 429 });
  const body = await readJson<{ password?: string }>(request);
  if (!checkPassword(String(body?.password ?? ""))) {
    f.n++;
    f.until = Date.now() + Math.min(60_000, 500 * 2 ** Math.min(f.n, 7));
    return NextResponse.json({ error: "Wrong password" }, { status: 403 });
  }
  f.n = 0;
  const { id } = await createSession({ userId: "password", method: "password", email: null, tailscaleLogin: request.headers.get("tailscale-user-login") });
  const res = NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, id, cookieOptions(request, SESSION_TTL_MS / 1000));
  return res;
}
