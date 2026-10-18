import { test } from "node:test";
import assert from "node:assert/strict";
import { eventIn, mergeTwins } from "./event-twins";
import type { CalendarEvent } from "./types";

const ev = (id: string, provider: CalendarEvent["provider"], title = "Team all-hands", start = 1000, end = 2000): CalendarEvent => ({
  id, calendarId: id.split("#")[0], provider, title, start, end, allDay: false, color: "#000",
});

test("the same event from two calendars shows once, from this Mac's calendar", () => {
  const out = mergeTwins([ev("google:a#1", "google"), ev("mac:local:b#1", "mac"), ev("x#2", "google", "Other")], new Set());
  assert.equal(out.length, 2);
  const m = out.find((e) => e.title === "Team all-hands")!;
  assert.equal(m.id, "mac:local:b#1");
  assert.deepEqual(m.twins, ["google:a#1"]);
  assert.ok(eventIn(new Set(["google:a#1"]), m), "a plan made from the twin still counts");
});

test("different times are different events; hiding a twin hides the merged one", () => {
  assert.equal(mergeTwins([ev("a", "google"), ev("b", "mac", undefined, 1000, 3000)], new Set()).length, 2);
  assert.equal(mergeTwins([ev("a", "google"), ev("b", "mac")], new Set(["a"])).length, 0);
});
