import type { Activity, Plan } from "./types";
import { expandPlans } from "./plans";
import { addDays, startOfDay } from "./time";

export interface NowPlan {
  name: string;
  color: string;
  start: number;
  end: number;
}

/** GET /api/now body (read by the Mac menu bar app, tools/menubar). */
export interface NowResponse {
  now: number;
  current: NowPlan | null;
  next: NowPlan | null;
}

/**
 * The plan in progress at `now` and the next one starting later today (local time, midnight
 * to midnight). All-day plans are skipped: they'd occupy the menu bar all day. When plans
 * overlap, the one that started last is "current" (it's the more specific slot).
 */
export function currentAndNext(plans: Plan[], activities: Activity[], now: number): NowResponse {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const dayEnd = addDays(startOfDay(now), 1);
  const occ = expandPlans(
    plans.filter((p) => !p.allDay),
    now,
    dayEnd,
  );
  const view = (p: Plan, start: number, end: number): NowPlan => {
    const act = byId.get(p.activityId);
    return { name: p.name.trim() || act?.name || "Plan", color: p.color || act?.color || "#8e8e93", start, end };
  };
  let current: NowPlan | null = null;
  let next: NowPlan | null = null;
  for (const o of occ) {
    if (o.start <= now && now < o.end) {
      if (!current || o.start >= current.start) current = view(o.plan, o.start, o.end);
    } else if (o.start > now && !next) {
      next = view(o.plan, o.start, o.end);
    }
  }
  return { now, current, next };
}
