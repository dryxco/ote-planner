import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authOff, getSession, tailscaleGate } from "@/lib/server/auth";

// Paths reachable without a session (still behind the Tailscale gate).
const PUBLIC = ["/login", "/api/auth/methods", "/api/auth/password", "/api/auth/device/start", "/api/auth/device/poll", "/sw.js"];

/** Auth gate in front of every page and API route. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const denied = tailscaleGate(request.headers);
  if (denied) {
    return new NextResponse(`Access denied: ${denied}`, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (PUBLIC.includes(pathname) || authOff()) return NextResponse.next();
  // The Mac menu bar app (tools/menubar) can't sign in; it sends a bearer token that the route
  // itself verifies. Only this one read-only route accepts it.
  if (pathname === "/api/now" && request.headers.has("authorization")) return NextResponse.next();

  if (getSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname + search)}`, publicOrigin(request)));
}

/** Origin the browser used (behind `tailscale serve` the request URL is the local upstream). */
function publicOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}

export const config = {
  // everything except Next's static assets and the icon
  // home-screen install files (manifest, icons) are public: iOS may fetch them without cookies
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
