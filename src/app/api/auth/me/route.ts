import { SESSION_COOKIE, authOff, getSession, readCookie } from "@/lib/server/auth";
import { json } from "@/lib/server/http";

export async function GET(request: Request) {
  if (authOff()) return json({ userId: null, method: "off", email: null, expiresAt: null, tailscaleLogin: null });
  const s = getSession(readCookie(request, SESSION_COOKIE));
  if (!s) return json({ error: "Sign in required" }, 401);
  return json({ userId: s.userId, method: s.method, email: s.email, expiresAt: s.expiresAt, tailscaleLogin: s.tailscaleLogin });
}
