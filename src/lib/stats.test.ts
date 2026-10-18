import { test } from "node:test";
import assert from "node:assert/strict";
import type { Actual, Plan } from "./types";
import { bucketsFor, computeReview, fmtPct, goalDays, goalProgress, periodLabel, periodLabelWithYear, periodRemainingLabel, periodStart } from "./stats";

const H = 3_600_000;
const day = (m: number, d: number) => new Date(2026, m - 1, d).getTime();
const at = (m: number, d: number, h: number, min = 0) => new Date(2026, m - 1, d, h, min).getTime();

const plan = (id: string, activityId: string, start: number, end: number): Plan => ({
  id, name: id, activityId, color: "#000", allDay: false, start, end, repeat: "never",
  reminder: "activity", endConfirmation: "activity", createdAt: 0,
});
const actual = (id: string, activityId: string, start: number, end: number, planKey?: string): Actual => ({
  id, name: id, activityId, color: "#000", start, end, planKey, createdAt: 0,
});

test("periods and labels", () => {
  const ws = periodStart("week", day(10, 7), 0);
  assert.equal(ws, day(10, 4));
  assert.equal(periodStart("week", day(10, 7), 1), day(10, 5));
  assert.equal(periodLabel("week", day(9, 27)), "9/27 – 10/3");
  assert.equal(periodLabelWithYear("week", ws), "10/4–10, 2026");
  assert.equal(periodLabelWithYear("week", day(9, 27)), "9/27–10/3, 2026");
  assert.equal(periodLabel("month", day(10, 1)), "10/2026");
  assert.equal(periodRemainingLabel(ws, day(10, 11), day(10, 7)), "4 days left including today");
  // October 2026 starts on a Thursday: 10/1–3, 4–10, 11–17, 18–24, 25–31
  assert.deepEqual(bucketsFor("month", day(10, 1), 0).map((b) => b.label), ["10/1", "10/4", "10/11", "10/18", "10/25"]);
});

test("sync and attainment", () => {
  // Mon 10/5: Work 9–11 (2h). Did 9:30–10:30 work (1h matched) + linked 30m in the evening.
  // Tue 10/6: Read 20–21 (1h), nothing done.
  const p1 = plan("p1", "work", at(10, 5, 9), at(10, 5, 11));
  const p2 = plan("p2", "reading", at(10, 6, 20), at(10, 6, 21));
  const future = plan("p3", "work", at(10, 9, 9), at(10, 9, 10));
  const actuals = [
    actual("a1", "work", at(10, 5, 9, 30), at(10, 5, 10, 30)),
    actual("a2", "work", at(10, 5, 19), at(10, 5, 19, 30), `p1@${at(10, 5, 9)}`),
    actual("a3", "meal", at(10, 6, 12), at(10, 6, 13)),
  ];
  const r = computeReview({
    plans: [p1, p2, future], actuals, kind: "week", start: day(10, 4), dayStart: 300, weekStartsOn: 0, now: at(10, 7, 12),
  });
  assert.equal(r.planned, 3 * H); // future plan excluded
  assert.equal(r.matched, 1 * H);
  assert.equal(r.elsewhere, 0.5 * H);
  assert.equal(fmtPct(r.sync), "33%");
  assert.equal(fmtPct(r.attainment), "50%");
  assert.equal(r.daysWithPlan, 2);
  assert.equal(r.totalDays, 7);
  assert.deepEqual(r.buckets.map((b) => fmtPct(b.sync)), ["—", "50%", "0%", "—", "—", "—", "—"]);
  const work = r.activities.find((a) => a.activityId === "work")!;
  assert.equal(work.actual, 1.5 * H);
  assert.ok(r.activities.some((a) => a.activityId === "meal" && a.planned === 0));
  assert.equal(r.actual, 2.5 * H);

  const empty = computeReview({ plans: [], actuals: [], kind: "week", start: day(10, 4), dayStart: 300, weekStartsOn: 0, now: at(10, 7, 12) });
  assert.equal(fmtPct(empty.sync), "—");
});

test("goal progress", () => {
  const actuals = [actual("a", "work", at(10, 5, 9), at(10, 5, 11)), actual("b", "work", at(10, 6, 9), at(10, 6, 9, 20))];
  const g = { id: "g", period: "week" as const, periodStart: day(10, 4), activityId: "work", target: 300, createdAt: 0 };
  assert.equal(goalProgress({ ...g, kind: "time" }, actuals, 300), 140);
  assert.equal(goalProgress({ ...g, kind: "count" }, actuals, 300), 2);
});

test("daily goal: days with enough records, today only once it's kept", () => {
  const water = (id: string, d: number, h: number) => actual(id, "water", at(10, d, h), at(10, d, h, 1));
  const actuals = [
    ...[8, 10, 12, 14, 16].map((h, i) => water(`a${i}`, 4, h)), // Sun: 5
    ...[8, 10].map((h, i) => water(`b${i}`, 5, h)), // Mon: 2
    ...[8, 9, 10, 11, 12].map((h, i) => water(`c${i}`, 6, h)), // Tue (today): 5
  ];
  const g = { id: "g", period: "week" as const, periodStart: day(10, 4), kind: "daily" as const, activityId: "water", target: 5, createdAt: 0 };
  assert.deepEqual(goalDays(g, [], actuals, 300, at(10, 6, 13)), { kept: 2, days: 3 });
  // today not kept yet: not judged until it closes
  assert.deepEqual(goalDays(g, [], actuals.slice(0, 7), 300, at(10, 6, 13)), { kept: 1, days: 2 });
});

test("on-time goal: first actual no later than the first plan; days without a plan left out", () => {
  const plans = [5, 6, 7, 8].map((d) => plan(`p${d}`, "commute", at(10, d, 9), at(10, d, 9, 1)));
  const actuals = [
    actual("a5", "commute", at(10, 5, 9), at(10, 5, 9, 1)), // exactly on time
    actual("a6", "commute", at(10, 6, 9, 3), at(10, 6, 9, 4)), // late
    actual("a6b", "commute", at(10, 6, 18), at(10, 6, 18, 1)), // evening — not the first
    actual("a4", "commute", at(10, 4, 20), at(10, 4, 20, 1)), // Sunday: no plan
    // Wed 7: nothing recorded (closed → missed); Thu 8 (today): nothing yet → not judged
  ];
  const g = { id: "g", period: "week" as const, periodStart: day(10, 4), kind: "onTime" as const, activityId: "commute", target: 1, createdAt: 0 };
  assert.deepEqual(goalDays(g, plans, actuals, 300, at(10, 8, 10)), { kept: 1, days: 3 });
  // a second on-time record seconds into the planned minute still counts
  const early = [...actuals, actual("a8", "commute", at(10, 8, 9) + 30_000, at(10, 8, 9, 1))];
  assert.deepEqual(goalDays(g, plans, early, 300, at(10, 8, 10)), { kept: 2, days: 4 });
});
