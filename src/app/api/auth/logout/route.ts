import { NextResponse } from "next/server";
import { SESSION_COOKIE, deleteSession, readCookie } from "@/lib/server/auth";
import { checkSameOrigin } from "@/lib/server/http";

export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  await deleteSession(readCookie(request, SESSION_COOKIE));
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
