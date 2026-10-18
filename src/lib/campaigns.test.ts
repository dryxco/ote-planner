import { test } from "node:test";
import assert from "node:assert/strict";
import type { Actual, Campaign, Ticket, Todo } from "./types";
import { campaignProgress, campaignTime, dueLabel } from "./campaigns";

const day = (m: number, d: number) => new Date(2026, m - 1, d).getTime();
const at = (m: number, d: number, h: number, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const H = 3_600_000;
const actual = (activityId: string, start: number, end: number): Actual => ({ id: `${activityId}${start}`, name: "", activityId, color: "#000", start, end, createdAt: 0 });
const camp: Campaign = { id: "c", name: "Healthy living", start: day(10, 12), due: day(10, 18), activityIds: ["exercise", "sleep"], tags: [], createdAt: day(10, 1) };

test("project time: linked activities, start through the due day", () => {
  const actuals = [
    actual("exercise", at(10, 11, 18), at(10, 11, 19)), // before the start
    actual("exercise", at(10, 12, 18), at(10, 12, 19)), // 1h
    actual("sleep", at(10, 12, 23), at(10, 13, 7)), // 8h
    actual("work", at(10, 13, 9), at(10, 13, 12)), // not linked
    actual("exercise", at(10, 19, 4), at(10, 19, 4, 30)), // before 05:00 on the 19th: still the 18th's logical day
    actual("exercise", at(10, 19, 9), at(10, 19, 10)), // after the due day
  ];
  assert.equal(campaignTime(camp, actuals, 300, at(10, 25, 0)), 9.5 * H);
  // still running: counted up to now
  assert.equal(campaignTime(camp, actuals, 300, at(10, 12, 18, 30)), 0.5 * H);
  assert.equal(campaignTime({ ...camp, activityIds: [] }, actuals, 300, at(10, 25, 0)), 0);
});

test("project progress counts done tasks and finished tickets", () => {
  const todo = (id: string, done: boolean, campaignId?: string): Todo => ({ id, name: id, activityId: "work", color: "#000", done, campaignId, createdAt: 0 });
  const ticket = (id: string, statusGroup: Ticket["statusGroup"], hidden = false): Ticket => ({ id, projectId: "p", title: id, status: "", statusGroup, campaignId: "c", hidden, createdAt: 0 });
  const p = campaignProgress(camp, [todo("a", true, "c"), todo("b", false, "c"), todo("x", true)], [ticket("t1", "complete"), ticket("t2", "to_do"), ticket("t3", "complete", true)]);
  assert.deepEqual(p, { done: 2, total: 4 });
});

test("due labels", () => {
  assert.equal(dueLabel(day(10, 15), day(10, 12)), "D-3");
  assert.equal(dueLabel(day(10, 12), day(10, 12)), "D-day");
  assert.equal(dueLabel(day(10, 11), day(10, 12)), "1 day over");
  assert.equal(dueLabel(day(10, 9), day(10, 12)), "3 days over");
});
