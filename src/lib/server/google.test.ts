import { test } from "node:test";
import assert from "node:assert/strict";
import { mapGoogleEvent } from "./google";
import { dateStringToMidnight } from "./time";
import type { CalendarInfo } from "../types";

const cal: CalendarInfo = { id: "google:sub1:primary", provider: "google", accountId: "sub1", name: "Me", color: "#039be5" };

test("google all-day, recurring instance id, and filtered events", () => {
  const allDay = mapGoogleEvent({ id: "e1", summary: "Holiday", start: { date: "2026-10-09" }, end: { date: "2026-10-10" } }, cal, "Asia/Seoul")!;
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.start, dateStringToMidnight("2026-10-09", "Asia/Seoul"));
  assert.equal(allDay.end, dateStringToMidnight("2026-10-10", "Asia/Seoul"));
  assert.equal(allDay.color, "#039be5");

  const inst = mapGoogleEvent(
    {
      id: "base_20261012T000000Z",
      recurringEventId: "base",
      originalStartTime: { dateTime: "2026-10-12T09:00:00+09:00" },
      start: { dateTime: "2026-10-12T11:00:00+09:00" },
      end: { dateTime: "2026-10-12T12:00:00+09:00" },
      description: "line1<br>a &amp; b",
    },
    cal,
  )!;
  assert.equal(inst.id, `google:sub1:primary:base:${Date.parse("2026-10-12T00:00:00Z")}`);
  assert.equal(inst.start, Date.parse("2026-10-12T02:00:00Z"));
  assert.equal(inst.notes, "line1\na & b");
  assert.equal(inst.title, "(No title)");

  assert.equal(mapGoogleEvent({ id: "c", status: "cancelled", start: { date: "2026-10-01" } }, cal), null);
  assert.equal(
    mapGoogleEvent({ id: "d", start: { dateTime: "2026-10-01T00:00:00Z" }, end: { dateTime: "2026-10-01T01:00:00Z" }, attendees: [{ self: true, responseStatus: "declined" }] }, cal),
    null,
  );
});
