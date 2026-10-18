import { test } from "node:test";
import assert from "node:assert/strict";
import type { Activity, Plan } from "./types";
import { currentAndNext } from "./now";

const at = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min).getTime();

const plan = (id: string, start: number, end: number, extra: Partial<Plan> = {}): Plan => ({
  id, name: id, activityId: "work", color: "#2f7fd8", allDay: false, start, end, repeat: "never",
  reminder: "activity", endConfirmation: "activity", createdAt: 0, ...extra,
});
const activities: Activity[] = [{ id: "work", name: "Work", color: "#ff9f0a", order: 0, reminder: "none", endConfirmation: false }];

test("current plan and the next one today", () => {
  const plans = [plan("Meeting", at(8, 10), at(8, 11)), plan("Gym", at(8, 14), at(8, 15)), plan("Tomorrow", at(9, 9), at(9, 10))];
  const r = currentAndNext(plans, activities, at(8, 10, 37));
  assert.deepEqual(r.current, { name: "Meeting", color: "#2f7fd8", start: at(8, 10), end: at(8, 11) });
  assert.equal(r.next?.name, "Gym");
  assert.equal(r.now, at(8, 10, 37));
});

test("between plans: no current; nothing left today: no next", () => {
  const plans = [plan("Meeting", at(8, 10), at(8, 11)), plan("Tomorrow", at(9, 9), at(9, 10))];
  assert.equal(currentAndNext(plans, activities, at(8, 11)).current, null, "end is exclusive");
  assert.deepEqual(currentAndNext(plans, activities, at(8, 12)), { now: at(8, 12), current: null, next: null });
  assert.equal(currentAndNext(plans, activities, at(8, 9)).next?.name, "Meeting");
});

test("unnamed plans use the activity name; all-day plans are ignored", () => {
  const plans = [plan("", at(8, 9), at(8, 12), { color: "" }), plan("Holiday", at(8, 0), at(9, 0), { allDay: true })];
  const r = currentAndNext(plans, activities, at(8, 10));
  assert.equal(r.current?.name, "Work");
  assert.equal(r.current?.color, "#ff9f0a", "falls back to the activity color");
});

test("repeating plans expand to today's occurrence; skipped occurrences don't count", () => {
  const daily = plan("Standup", at(1, 9), at(1, 9, 30), { repeat: "daily" });
  const r = currentAndNext([daily], activities, at(8, 9, 10));
  assert.deepEqual([r.current?.start, r.current?.end], [at(8, 9), at(8, 9, 30)]);
  assert.equal(currentAndNext([{ ...daily, exceptions: [at(8, 9)] }], activities, at(8, 9, 10)).current, null);
});

test("overlapping plans: the one that started last is current", () => {
  const plans = [plan("Deep work", at(8, 9), at(8, 12)), plan("Call", at(8, 10), at(8, 10, 30))];
  assert.equal(currentAndNext(plans, activities, at(8, 10, 5)).current?.name, "Call");
  assert.equal(currentAndNext(plans, activities, at(8, 11)).current?.name, "Deep work");
});
