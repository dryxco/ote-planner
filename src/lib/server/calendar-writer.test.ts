import { test } from "node:test";
import assert from "node:assert/strict";
import { findDeletedInCalendar } from "./calendar-writer";
import type { Plan } from "../types";

const plan = (id: string, name: string, start: number, end: number): Plan =>
  ({ id, name, activityId: "work", color: "#000", allDay: false, start, end, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: 0 }) as Plan;

test("an event deleted in Calendar deletes its plan; one still there doesn't", () => {
  const linked = [
    { planId: "a", link: { eventId: "ek-a", calendarId: "cal" }, plan: plan("a", "Gym", 1000, 2000) },
    { planId: "b", link: { eventId: "ek-b", calendarId: "cal" }, plan: plan("b", "Meal", 3000, 4000) },
  ];
  const r = findDeletedInCalendar(linked, [{ calendarId: "cal", title: "Gym", start: 1000, end: 2000, ekId: "ek-a" }]);
  assert.deepEqual(r.deleted, ["b"]);
  assert.deepEqual(r.relinked, {});
});

test("an event whose id changed (same calendar, title, times) is re-linked, not deleted", () => {
  const linked = [{ planId: "a", link: { eventId: "ek-old", calendarId: "cal" }, plan: plan("a", "Gym", 1000, 2000) }];
  const r = findDeletedInCalendar(linked, [{ calendarId: "cal", title: "Gym", start: 1000, end: 2000, ekId: "ek-new" }]);
  assert.deepEqual(r.deleted, []);
  assert.deepEqual(r.relinked, { a: "ek-new" });
});
