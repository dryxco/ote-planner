import { test } from "node:test";
import assert from "node:assert/strict";
import type { Plan } from "../types";
import { dueAlerts } from "./push";

const MIN = 60_000;
const plan = (over: Partial<Plan>): Plan => ({
  id: "p",
  name: "Gym",
  activityId: "exercise",
  color: "#e3933a",
  allDay: false,
  start: Date.UTC(2026, 9, 8, 6, 0), // 15:00 KST
  end: Date.UTC(2026, 9, 8, 7, 0),
  repeat: "never",
  reminder: "activity",
  endConfirmation: "activity",
  createdAt: 0,
  ...over,
});
const names = new Map([["exercise", "Exercise"]]);

test("10 minutes before the start, once the moment has come (and not when it's stale)", () => {
  const p = plan({});
  assert.deepEqual(dueAlerts([p], names, p.start - 11 * MIN), []);
  const a = dueAlerts([p], names, p.start - 10 * MIN);
  assert.equal(a.length, 1);
  assert.equal(a[0].key, `start:p@${p.start}`);
  assert.equal(a[0].title, "Gym in 10 min");
  assert.equal(a[0].body, "3:00 PM – 4:00 PM");
  assert.equal(dueAlerts([p], names, p.start - 8 * MIN).length, 1, "a late tick still sends it");
  assert.equal(dueAlerts([p], names, p.start - 6 * MIN).length, 0, "but not minutes later");
});

test("at the end", () => {
  const p = plan({});
  const a = dueAlerts([p], names, p.end + 30_000);
  assert.deepEqual(a.map((x) => x.key), [`end:p@${p.start}`]);
  assert.equal(a[0].title, "Gym — time's up");
});

test("unnamed plans use the activity; all-day plans never alert; repeating plans alert per occurrence", () => {
  assert.equal(dueAlerts([plan({ name: "" })], names, plan({}).start - 10 * MIN)[0].title, "Exercise in 10 min");
  assert.deepEqual(dueAlerts([plan({ allDay: true })], names, plan({}).start - 10 * MIN), []);
  const daily = plan({ repeat: "daily", start: Date.UTC(2026, 9, 1, 6, 0), end: Date.UTC(2026, 9, 1, 7, 0) });
  const a = dueAlerts([daily], names, Date.UTC(2026, 9, 8, 5, 50));
  assert.deepEqual(a.map((x) => x.key), [`start:p@${Date.UTC(2026, 9, 8, 6, 0)}`]);
});
