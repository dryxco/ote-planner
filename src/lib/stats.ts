// Pure period + plan-vs-actual statistics shared by Review, Activities and Goals.
// Periods are expressed as calendar dates (local midnight ms); the time range a period
// covers runs from its first logical day start to the logical day start after it.

import type { Actual, Goal, GoalPeriod, Plan, PlanOccurrence } from "./types";
import { expandPlans, occurrenceFulfilment } from "./plans";
import { DAY, WEEKDAY_LETTER, addDays, addMonths, logicalDate, logicalDayRange, overlap, startOfDay, startOfMonth, startOfWeek, startOfYear } from "./time";

export type PeriodKind = GoalPeriod;

/** First date of the period containing `date`. */
export function periodStart(kind: PeriodKind, date: number, weekStartsOn: number): number {
  if (kind === "week") return startOfWeek(date, weekStartsOn);
  if (kind === "month") return startOfMonth(date);
  return startOfYear(date);
}

/** Move a period start by `n` periods. */
export function shiftPeriod(kind: PeriodKind, start: number, n: number): number {
  if (kind === "week") return addDays(start, 7 * n);
  if (kind === "month") return addMonths(start, n);
  return addMonths(start, 12 * n);
}

/** Exclusive end date of the period. */
export const periodEnd = (kind: PeriodKind, start: number) => shiftPeriod(kind, start, 1);

/** Every calendar date in [start, end). */
export function datesIn(start: number, end: number): number[] {
  const out: number[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** [from, to) in ms covered by the logical days of dates [start, end). */
export function periodRange(start: number, end: number, dayStart: number): [number, number] {
  return [logicalDayRange(start, dayStart)[0], logicalDayRange(end, dayStart)[0]];
}

const md = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** Review style: "9/27 – 10/3", "10/2026", "2026". */
export function periodLabel(kind: PeriodKind, start: number): string {
  const d = new Date(start);
  if (kind === "month") return `${d.getMonth() + 1}/${d.getFullYear()}`;
  if (kind === "year") return String(d.getFullYear());
  return `${md(start)} – ${md(addDays(start, 6))}`;
}

/** Goals style: "10/4–10, 2026", "9/27–10/3, 2026", "10/2026", "2026". */
export function periodLabelWithYear(kind: PeriodKind, start: number): string {
  if (kind !== "week") return periodLabel(kind, start);
  const s = new Date(start);
  const e = new Date(addDays(start, 6));
  const tail = s.getMonth() === e.getMonth() ? String(e.getDate()) : md(e.getTime());
  const year = s.getFullYear() === e.getFullYear() ? `${e.getFullYear()}` : `${s.getFullYear()}–${e.getFullYear()}`;
  return `${md(start)}–${tail}, ${year}`;
}

/** "4 days left including today" / "Ended" / "Starts in 3 days". */
export function periodRemainingLabel(start: number, end: number, today: number): string {
  if (today >= end) return "Ended";
  if (today < start) {
    const n = Math.round((startOfDay(start) - startOfDay(today)) / DAY);
    return n === 1 ? "Starts tomorrow" : `Starts in ${n} days`;
  }
  const left = Math.round((startOfDay(end) - startOfDay(today)) / DAY);
  return left === 1 ? "Last day" : `${left} days left including today`;
}

// ---- plan vs actual ----

export interface Fulfilment {
  /** Planned time (ms). */
  planned: number;
  /** Actual time of the same activity (or linked) inside the plan slot. */
  matched: number;
  /** Linked actual time outside the plan slot. */
  elsewhere: number;
}

/**
 * Non-all-day plan occurrences that start in [from, to) and have started before `now`.
 * Ongoing occurrences are clipped to `now` so the current period isn't penalised for the future.
 */
export function occurrencesIn(plans: Plan[], from: number, to: number, now: number): PlanOccurrence[] {
  return expandPlans(plans, from, to)
    .filter((o) => !o.plan.allDay && o.start >= from && o.start < to && o.start < now)
    .map((o) => (o.end > now ? { ...o, end: now } : o));
}

export function fulfil(occs: PlanOccurrence[], actuals: Actual[]): Fulfilment {
  const f: Fulfilment = { planned: 0, matched: 0, elsewhere: 0 };
  for (const o of occs) {
    const r = occurrenceFulfilment(o, actuals);
    f.planned += r.duration;
    f.matched += r.matched;
    f.elsewhere += r.elsewhere;
  }
  return f;
}

/** Matched / Planned, or null when nothing was planned. */
export const syncRate = (f: Fulfilment) => (f.planned > 0 ? f.matched / f.planned : null);
/** (Matched + At another time) / Planned, or null when nothing was planned. */
export const attainmentRate = (f: Fulfilment) => (f.planned > 0 ? (f.matched + f.elsewhere) / f.planned : null);

export const fmtPct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** Actual time (ms) of actuals clipped to [from, to), optionally for one activity. */
export function actualTime(actuals: Actual[], from: number, to: number, activityId?: string): number {
  let sum = 0;
  for (const a of actuals) if (!activityId || a.activityId === activityId) sum += overlap(a.start, a.end, from, to);
  return sum;
}

/** Number of actual records starting in [from, to) for one activity. */
export function actualCount(actuals: Actual[], from: number, to: number, activityId: string): number {
  return actuals.filter((a) => a.activityId === activityId && a.start >= from && a.start < to).length;
}

export interface Bucket {
  label: string;
  /** dates [start, end) */
  start: number;
  end: number;
}

const MONTH_LETTER = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Chart columns: days of a week, weeks of a month (split at week starts), months of a year. */
export function bucketsFor(kind: PeriodKind, start: number, weekStartsOn: number): Bucket[] {
  const end = periodEnd(kind, start);
  if (kind === "week")
    return datesIn(start, end).map((d) => ({ label: WEEKDAY_LETTER[new Date(d).getDay()], start: d, end: addDays(d, 1) }));
  if (kind === "year")
    return Array.from({ length: 12 }, (_, i) => {
      const s = addMonths(start, i);
      return { label: MONTH_LETTER[i], start: s, end: addMonths(start, i + 1) };
    });
  const out: Bucket[] = [];
  let s = start;
  while (s < end) {
    const e = Math.min(addDays(startOfWeek(s, weekStartsOn), 7), end);
    out.push({ label: md(s), start: s, end: e });
    s = e;
  }
  return out;
}

export interface ActivityStat extends Fulfilment {
  activityId: string;
  /** Actual time recorded in the period. */
  actual: number;
}

export interface ReviewStats extends Fulfilment {
  actual: number;
  sync: number | null;
  attainment: number | null;
  buckets: (Bucket & { sync: number | null })[];
  daysWithPlan: number;
  totalDays: number;
  /** Activities with plans or actuals in the period (unordered). */
  activities: ActivityStat[];
}

export function computeReview(input: {
  plans: Plan[];
  actuals: Actual[];
  kind: PeriodKind;
  start: number;
  dayStart: number;
  weekStartsOn: number;
  now: number;
}): ReviewStats {
  const { plans, actuals, kind, start, dayStart, weekStartsOn, now } = input;
  const end = periodEnd(kind, start);
  const [from, to] = periodRange(start, end, dayStart);
  const occs = occurrencesIn(plans, from, to, now);
  const total = fulfil(occs, actuals);

  const buckets = bucketsFor(kind, start, weekStartsOn).map((b) => {
    const [bf, bt] = periodRange(b.start, b.end, dayStart);
    return { ...b, sync: syncRate(fulfil(occs.filter((o) => o.start >= bf && o.start < bt), actuals)) };
  });

  const planDays = new Set(occs.map((o) => logicalDate(o.start, dayStart)));

  const ids = new Set<string>();
  occs.forEach((o) => ids.add(o.plan.activityId));
  actuals.forEach((a) => overlap(a.start, a.end, from, to) > 0 && ids.add(a.activityId));
  const activities = [...ids].map((id) => ({
    activityId: id,
    ...fulfil(
      occs.filter((o) => o.plan.activityId === id),
      actuals,
    ),
    actual: actualTime(actuals, from, to, id),
  }));

  return {
    ...total,
    actual: actualTime(actuals, from, to),
    sync: syncRate(total),
    attainment: attainmentRate(total),
    buckets,
    daysWithPlan: planDays.size,
    totalDays: datesIn(start, end).length,
    activities,
  };
}

export const isDayGoal = (g: Goal) => g.kind === "daily" || g.kind === "onTime";

/**
 * A daily or on-time goal: days kept / days judged so far. A day is judged once it has closed, or
 * earlier when it's already kept (today, an on-time day is judged as soon as its first actual is
 * there). On-time days without a plan of the activity aren't judged at all.
 */
export function goalDays(goal: Goal, plans: Plan[], actuals: Actual[], dayStart: number, now: number): { kept: number; days: number } {
  let kept = 0;
  let days = 0;
  const minute = (t: number) => Math.floor(t / 60_000);
  for (const date of datesIn(goal.periodStart, periodEnd(goal.period, goal.periodStart))) {
    const [from, to] = logicalDayRange(date, dayStart);
    if (from >= now) break;
    const closed = now >= to;
    if (goal.kind === "daily") {
      const ok = actualCount(actuals, from, to, goal.activityId) >= goal.target;
      if (ok || closed) days++;
      if (ok) kept++;
      continue;
    }
    const occs = expandPlans(plans, from, to).filter((o) => !o.plan.allDay && o.plan.activityId === goal.activityId && o.start >= from && o.start < to);
    if (!occs.length) continue;
    const keys = new Set(occs.map((o) => o.key));
    const planned = Math.min(...occs.map((o) => o.start));
    const started = actuals.filter((a) => (a.activityId === goal.activityId || (a.planKey && keys.has(a.planKey))) && a.start >= from && a.start < to);
    if (!started.length) {
      if (closed) days++;
      continue;
    }
    days++;
    if (minute(Math.min(...started.map((a) => a.start))) <= minute(planned)) kept++;
  }
  return { kept, days };
}

/** Progress of a goal from actuals in its period: minutes (time) or record count. */
export function goalProgress(goal: Goal, actuals: Actual[], dayStart: number): number {
  const [from, to] = periodRange(goal.periodStart, periodEnd(goal.period, goal.periodStart), dayStart);
  if (goal.kind === "count") return actualCount(actuals, from, to, goal.activityId);
  return Math.round(actualTime(actuals, from, to, goal.activityId) / 60_000);
}
