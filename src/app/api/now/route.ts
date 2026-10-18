import { SESSION_COOKIE, getSession, readCookie } from "@/lib/server/auth";
import { json } from "@/lib/server/http";
import { isMenubarRequest } from "@/lib/server/menubar-token";
import { readCollection } from "@/lib/server/syncdb";
import { currentAndNext, type NowResponse } from "@/lib/now";
import type { Activity, Plan } from "@/lib/types";

/**
 * GET /api/now -> {now, current, next}: the plan in progress and the next one today, for the
 * Mac menu bar app. Accepts the menu bar token (Authorization: Bearer) or a normal session.
 */
export async function GET(request: Request) {
  // src/proxy.ts lets requests with an Authorization header through without a session, so the
  // token is checked here; a session cookie also works (handy from the browser).
  if (!getSession(readCookie(request, SESSION_COOKIE)) && !(await isMenubarRequest(request))) {
    return json({ error: "Invalid menu bar token" }, 401);
  }
  try {
    // the menu bar shows the shared data set (dataOwner is "default" for every request)
    const [plans, activities] = await Promise.all([readCollection("default", "plans"), readCollection("default", "activities")]);
    const live = <T,>(rs: typeof plans) => rs.filter((r) => !r.deleted && r.data).map((r) => r.data as T);
    const body: NowResponse = currentAndNext(live<Plan>(plans), live<Activity>(activities), Date.now());
    return json(body);
  } catch (e) {
    return json({ error: `Couldn't read plans: ${(e as Error).message}` }, 500);
  }
}
