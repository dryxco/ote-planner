import type { Actual, Plan, PlanOccurrence } from "./types";
import { addDays, addMonths, startOfDay } from "./time";

export const occurrenceKey = (planId: string, start: number) => `${planId}@${start}`;

export function parseOccurrenceKey(key: string): { planId: string; start: number } {
  const at = key.lastIndexOf("@");
  return { planId: key.slice(0, at), start: Number(key.slice(at + 1)) };
}

/** Expand plans (incl. repeating ones) into concrete occurrences overlapping [from, to). */
export function expandPlans(plans: Plan[], from: number, to: number): PlanOccurrence[] {
  const out: PlanOccurrence[] = [];
  for (const plan of plans) {
    const dur = plan.end - plan.start;
    const exceptions = new Set(plan.exceptions ?? []);
    const push = (start: number) => {
      const end = start + dur;
      if (end <= from || start >= to || exceptions.has(start)) return;
      out.push({ plan, start, end, key: occurrenceKey(plan.id, start) });
    };
    if (plan.repeat === "never") {
      push(plan.start);
      continue;
    }
    // Walk occurrences from the series start; jump close to `from` for daily-ish series.
    let i = 0;
    let cursor = plan.start;
    if (plan.repeat === "daily" || plan.repeat === "weekdays" || plan.repeat === "weekly") {
      const stepDays = plan.repeat === "weekly" ? 7 : 1;
      const skip = Math.max(0, Math.floor((startOfDay(from) - startOfDay(plan.start)) / (stepDays * 86_400_000)) - 1);
      i = skip;
      cursor = addDays(plan.start, skip * stepDays);
      for (; cursor < to && i < 100_000; i++, cursor = addDays(plan.start, i * stepDays)) {
        if (plan.repeat === "weekdays") {
          const wd = new Date(cursor).getDay();
          if (wd === 0 || wd === 6) continue;
        }
        push(cursor);
      }
    } else if (plan.repeat === "monthly") {
      const base = new Date(plan.start);
      for (; i < 1200; i++) {
        const m = new Date(addMonths(plan.start, i));
        m.setDate(base.getDate());
        if (m.getDate() !== base.getDate()) continue; // e.g. the 31st in a short month
        m.setHours(base.getHours(), base.getMinutes(), 0, 0);
        cursor = m.getTime();
        if (cursor >= to) break;
        push(cursor);
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Actual-time that fulfils an occurrence: same-activity actuals overlapping its slot, plus linked ones. */
export function occurrenceFulfilment(occ: PlanOccurrence, actuals: Actual[]) {
  const dur = occ.end - occ.start;
  let matched = 0;
  let elsewhere = 0;
  for (const a of actuals) {
    const linked = a.planKey === occ.key;
    const sameAct = a.activityId === occ.plan.activityId;
    if (!linked && !sameAct) continue;
    const ov = Math.max(0, Math.min(a.end, occ.end) - Math.max(a.start, occ.start));
    if (ov > 0 && (linked || sameAct)) matched += ov;
    if (linked) elsewhere += a.end - a.start - ov;
  }
  matched = Math.min(matched, dur);
  elsewhere = Math.min(elsewhere, dur - matched);
  return { matched, elsewhere, duration: dur };
}

export function isOccurrenceKept(occ: PlanOccurrence, actuals: Actual[]): boolean {
  if (actuals.some((a) => a.planKey === occ.key)) return true;
  const f = occurrenceFulfilment(occ, actuals);
  return f.matched + f.elsewhere >= f.duration * 0.5;
}
