import { NextResponse } from "next/server";
import { LOGIN_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, cookieOptions, createSession, isAllowedUser, readCookie } from "@/lib/server/auth";
import { loginProvider } from "@/lib/server/connectors";
import { checkSameOrigin, errorMessage } from "@/lib/server/http";
import { getPending, removePending } from "@/lib/server/pending-logins";

/**
 * POST /api/auth/device/poll -> {status: "pending" | "ok" | "expired"} or {error}
 * Once approved on the sign-in server: check who it is against SYNC_ALLOWED_USERS, start a session.
 */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const login = loginProvider();
  const id = readCookie(request, LOGIN_COOKIE);
  const p = getPending(id);
  if (!login || !p) return NextResponse.json({ status: "expired" });
  const now = Date.now();
  if (now < p.nextPollAt) return NextResponse.json({ status: "pending" });
  p.nextPollAt = now + p.interval * 1000 - 200;

  try {
    const r = await login.poll(p.deviceCode);
    if (r.status === "pending") return NextResponse.json({ status: "pending" });
    removePending(id);
    if (r.status === "expired") return NextResponse.json({ status: "expired" });
    if (!r.userId || !isAllowedUser(r.userId, r.email)) {
      const res = NextResponse.json({ error: `This account (${r.email ?? r.userId}) isn't allowed to use Sync (SYNC_ALLOWED_USERS)` }, { status: 403 });
      res.cookies.delete(LOGIN_COOKIE);
      return res;
    }
    const { id: sid } = await createSession({ userId: r.userId, method: "device", email: r.email, tailscaleLogin: p.tailscaleLogin });
    const res = NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(SESSION_COOKIE, sid, cookieOptions(request, SESSION_TTL_MS / 1000));
    res.cookies.delete(LOGIN_COOKIE);
    return res;
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, "Sign-in failed") }, { status: 502 });
  }
}
