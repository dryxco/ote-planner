import { test } from "node:test";
import assert from "node:assert/strict";
import { icsToEvents } from "./ics";
import { dateStringToMidnight, wallTimeToMs } from "./time";
import type { CalendarInfo } from "../types";

const cal: CalendarInfo = { id: "apple:acc:home", provider: "apple", accountId: "acc", name: "Home", color: "#ff2968" };
const SEOUL = "Asia/Seoul";
const NY = "America/New_York";

const wrap = (body: string) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", body.trim(), "END:VCALENDAR"].join("\r\n");

test("wallTimeToMs handles fixed and DST zones", () => {
  assert.equal(wallTimeToMs(2026, 10, 7, 9, 0, 0, SEOUL), Date.UTC(2026, 9, 7, 0, 0, 0));
  // 2026-03-08 02:30 does not exist in New York -> lands after the gap (03:30 EDT = 07:30Z)
  assert.equal(wallTimeToMs(2026, 3, 8, 2, 30, 0, NY), Date.UTC(2026, 2, 8, 7, 30));
  // 2026-11-01 01:30 is ambiguous -> earlier instant (EDT, 05:30Z)
  assert.equal(wallTimeToMs(2026, 11, 1, 1, 30, 0, NY), Date.UTC(2026, 10, 1, 5, 30));
  assert.equal(dateStringToMidnight("2026-01-01", SEOUL), Date.UTC(2025, 11, 31, 15));
});

test("timed event with TZID (no VTIMEZONE) resolves via IANA", () => {
  const ics = wrap(`
BEGIN:VEVENT
UID:a1
DTSTART;TZID=America/New_York:20261007T090000
DTEND;TZID=America/New_York:20261007T103000
SUMMARY:Standup
LOCATION:Room 1
DESCRIPTION:notes here
END:VEVENT`);
  const evs = icsToEvents(ics, cal, { start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 9, 31) }, SEOUL);
  assert.equal(evs.length, 1);
  const e = evs[0];
  assert.equal(e.start, Date.UTC(2026, 9, 7, 13, 0));
  assert.equal(e.end, Date.UTC(2026, 9, 7, 14, 30));
  assert.equal(e.allDay, false);
  assert.equal(e.title, "Standup");
  assert.equal(e.location, "Room 1");
  assert.equal(e.notes, "notes here");
  assert.equal(e.color, "#ff2968");
  assert.equal(e.id, `apple:acc:home:a1:${e.start}`);
  assert.equal(e.uid, "a1", "the UID tells an event Ote wrote apart when it comes back through a feed");
});

test("UTC and floating times", () => {
  const ics = wrap(`
BEGIN:VEVENT
UID:u
DTSTART:20261007T000000Z
DTEND:20261007T010000Z
SUMMARY:utc
END:VEVENT
BEGIN:VEVENT
UID:f
DTSTART:20261007T090000
DTEND:20261007T100000
END:VEVENT`);
  const evs = icsToEvents(ics, cal, { start: Date.UTC(2026, 9, 6), end: Date.UTC(2026, 9, 8) }, SEOUL);
  const utc = evs.find((e) => e.title === "utc")!;
  assert.equal(utc.start, Date.UTC(2026, 9, 7, 0));
  const floating = evs.find((e) => e.id.includes(":f:"))!;
  assert.equal(floating.start, Date.UTC(2026, 9, 7, 0)); // 09:00 Seoul
  assert.equal(floating.title, "(No title)");
});

test("in-file VTIMEZONE with non-IANA name", () => {
  const ics = wrap(`
BEGIN:VTIMEZONE
TZID:Korea Standard Time
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:+0900
TZOFFSETTO:+0900
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:w
DTSTART;TZID=Korea Standard Time:20261007T090000
DTEND;TZID=Korea Standard Time:20261007T100000
END:VEVENT`);
  const evs = icsToEvents(ics, cal, { start: Date.UTC(2026, 9, 6), end: Date.UTC(2026, 9, 8) }, NY);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].start, Date.UTC(2026, 9, 7, 0));
});

test("all-day events: local midnight, exclusive end, missing DTEND", () => {
  const ics = wrap(`
BEGIN:VEVENT
UID:ad
DTSTART;VALUE=DATE:20261007
DTEND;VALUE=DATE:20261009
SUMMARY:Trip
END:VEVENT
BEGIN:VEVENT
UID:ad1
DTSTART;VALUE=DATE:20261010
SUMMARY:One day
END:VEVENT`);
  const evs = icsToEvents(ics, cal, { start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 9, 31) }, SEOUL);
  const trip = evs.find((e) => e.title === "Trip")!;
  assert.equal(trip.allDay, true);
  assert.equal(trip.start, dateStringToMidnight("2026-10-07", SEOUL));
  assert.equal(trip.end, dateStringToMidnight("2026-10-09", SEOUL));
  const one = evs.find((e) => e.title === "One day")!;
  assert.equal(one.start, dateStringToMidnight("2026-10-10", SEOUL));
  assert.equal(one.end, dateStringToMidnight("2026-10-11", SEOUL));
});

test("weekly RRULE with EXDATE, override, and cancelled instance; DST-stable wall time", () => {
  const ics = wrap(`
BEGIN:VEVENT
UID:r1
DTSTART;TZID=America/New_York:20261019T090000
DTEND;TZID=America/New_York:20261019T100000
RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6
EXDATE;TZID=America/New_York:20261026T090000
SUMMARY:Weekly
END:VEVENT
BEGIN:VEVENT
UID:r1
RECURRENCE-ID;TZID=America/New_York:20261102T090000
DTSTART;TZID=America/New_York:20261102T150000
DTEND;TZID=America/New_York:20261102T160000
SUMMARY:Weekly (moved)
END:VEVENT
BEGIN:VEVENT
UID:r1
RECURRENCE-ID;TZID=America/New_York:20261109T090000
DTSTART;TZID=America/New_York:20261109T090000
DTEND;TZID=America/New_York:20261109T100000
STATUS:CANCELLED
END:VEVENT`);
  const range = { start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 11, 31) };
  const evs = icsToEvents(ics, cal, range, NY);
  // 6 slots: 10/19, 10/26 (EXDATE), 11/2 (moved), 11/9 (cancelled), 11/16, 11/23
  assert.deepEqual(evs.map((e) => e.title), ["Weekly", "Weekly (moved)", "Weekly", "Weekly"]);
  assert.equal(evs[0].start, Date.UTC(2026, 9, 19, 13)); // EDT
  assert.equal(evs[2].start, Date.UTC(2026, 10, 16, 14)); // EST, still 09:00 local
  const moved = evs[1];
  assert.equal(moved.start, Date.UTC(2026, 10, 2, 20));
  // id keyed by original slot, so it is stable even though the instance moved
  assert.equal(moved.id, `${cal.id}:r1:${Date.UTC(2026, 10, 2, 14)}`);
  // ids are unique and deterministic across fetches
  const again = icsToEvents(ics, cal, range, NY);
  assert.deepEqual(again.map((e) => e.id), evs.map((e) => e.id));
  assert.equal(new Set(evs.map((e) => e.id)).size, evs.length);
});

test("recurrence is clipped to the range and open-ended rules terminate", () => {
  const ics = wrap(`
BEGIN:VEVENT
UID:daily
DTSTART;TZID=Asia/Seoul:20200101T070000
DTEND;TZID=Asia/Seoul:20200101T073000
RRULE:FREQ=DAILY
SUMMARY:Run
END:VEVENT`);
  const start = wallTimeToMs(2026, 10, 5, 0, 0, 0, SEOUL);
  const end = wallTimeToMs(2026, 10, 12, 0, 0, 0, SEOUL);
  const evs = icsToEvents(ics, cal, { start, end }, SEOUL);
  assert.equal(evs.length, 7);
  assert.equal(evs[0].start, wallTimeToMs(2026, 10, 5, 7, 0, 0, SEOUL));
});

test("all-day recurring yearly and malformed docs are skipped", () => {
  const good = wrap(`
BEGIN:VEVENT
UID:bday
DTSTART;VALUE=DATE:20000312
DTEND;VALUE=DATE:20000313
RRULE:FREQ=YEARLY
SUMMARY:Birthday
END:VEVENT`);
  const evs = icsToEvents(["garbage", good], cal, { start: Date.UTC(2027, 0, 1), end: Date.UTC(2027, 11, 31) }, SEOUL);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].allDay, true);
  assert.equal(evs[0].start, dateStringToMidnight("2027-03-12", SEOUL));
  assert.equal(evs[0].end, dateStringToMidnight("2027-03-13", SEOUL));
});
