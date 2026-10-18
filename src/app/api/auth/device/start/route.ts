import { NextResponse } from "next/server";
import { LOGIN_COOKIE, cookieOptions } from "@/lib/server/auth";
import { loginProvider } from "@/lib/server/connectors";
import { checkSameOrigin, errorMessage } from "@/lib/server/http";
import { addPending } from "@/lib/server/pending-logins";

/** POST /api/auth/device/start -> {userCode, verificationUri, expiresIn, interval} */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const login = loginProvider();
  if (!login) return NextResponse.json({ error: "Device sign-in isn't set up (SYNC_LOGIN_URL)" }, { status: 404 });
  try {
    const d = await login.start();
    const now = Date.now();
    const id = addPending({ deviceCode: d.deviceCode, expiresIn: d.expiresIn, interval: d.interval, createdAt: now, nextPollAt: now, tailscaleLogin: request.headers.get("tailscale-user-login") });
    const res = NextResponse.json(
      { userCode: d.userCode, verificationUri: d.verificationUri, expiresIn: d.expiresIn, interval: d.interval },
      { headers: { "Cache-Control": "no-store" } },
    );
    res.cookies.set(LOGIN_COOKIE, id, cookieOptions(request, d.expiresIn));
    return res;
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, "Couldn't start the sign-in") }, { status: 502 });
  }
}
