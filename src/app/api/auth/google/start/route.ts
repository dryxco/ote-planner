import { randomBytes } from "node:crypto";
import { connection, NextResponse } from "next/server";
import { buildAuthUrl, createPkce, OAUTH_COOKIE } from "@/lib/server/google";
import { appUrl, errorMessage, isSecureApp } from "@/lib/server/http";

/** GET /api/auth/google/start -> redirect to Google consent. */
export async function GET() {
  await connection();
  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = createPkce();
  let url: string;
  try {
    url = buildAuthUrl(state, challenge);
  } catch (err) {
    const msg = errorMessage(err, "Couldn't start Google sign-in");
    return NextResponse.redirect(`${appUrl()}/?settings=1&calendarError=${encodeURIComponent(msg)}`);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureApp(),
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
