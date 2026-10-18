import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { invalidate } from "@/lib/server/cache";
import { completeOAuth, OAUTH_COOKIE } from "@/lib/server/google";
import { appUrl, errorMessage } from "@/lib/server/http";

function done(error?: string): NextResponse {
  const target = error ? `${appUrl()}/?settings=1&calendarError=${encodeURIComponent(error)}` : `${appUrl()}/?settings=1`;
  const res = NextResponse.redirect(target);
  res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
  return res;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** GET /api/auth/google/callback?code&state -> store tokens, back to "/?settings=1". */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const oauthError = q.get("error");
  if (oauthError) {
    return done(oauthError === "access_denied" ? "Google connection cancelled (access denied)" : `Google sign-in error: ${oauthError}`);
  }
  const code = q.get("code");
  const state = q.get("state");
  const cookie = request.cookies.get(OAUTH_COOKIE)?.value ?? "";
  const [expectedState, verifier] = cookie.split(".");
  if (!code || !state || !expectedState || !verifier || !safeEqual(state, expectedState)) {
    return done("Google sign-in session expired or invalid (state mismatch). Try again");
  }
  try {
    const accountId = await completeOAuth(code, verifier);
    invalidate(`google:${accountId}:`);
    return done();
  } catch (err) {
    return done(errorMessage(err, "Couldn't connect Google"));
  }
}
