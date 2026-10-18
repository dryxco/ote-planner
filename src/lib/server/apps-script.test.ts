import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { icsToEvents } from "./ics";

// scripts/google-calendar-ics.gs is plain JS for Google Apps Script; load its pure builder here.
function loadBuilder(): (name: string, color: string, events: unknown[]) => string {
  const src = readFileSync(path.join(process.cwd(), "scripts/google-calendar-ics.gs"), "utf8");
  const mod = { exports: {} as { buildIcs?: (n: string, c: string, e: unknown[]) => string } };
  new Function("module", src)(mod);
  return mod.exports.buildIcs!;
}

test("Apps Script feed is read by Ote's iCal parser (timed, all-day, escaping)", () => {
  const buildIcs = loadBuilder();
  const ics = buildIcs("팀, 공유 캘린더", "#0b8043", [
    { id: "abc@google.com", title: "Review; budget, Q4", location: "회의실 3", description: "line1\nline2", allDay: false, start: new Date(Date.UTC(2026, 9, 7, 1, 0)), end: new Date(Date.UTC(2026, 9, 7, 2, 30)) },
    { id: "abc@google.com", title: "Review; budget, Q4", allDay: false, start: new Date(Date.UTC(2026, 9, 14, 1, 0)), end: new Date(Date.UTC(2026, 9, 14, 2, 30)) },
    { id: "hol@google.com", title: "Holiday", allDay: true, start: new Date(2026, 9, 9), end: new Date(2026, 9, 10) },
  ]);
  const cal = { id: "ics:x:feed", provider: "ics" as const, accountId: "x", name: "t", color: "#000" };
  const evs = icsToEvents(ics, cal, { start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 9, 31) }, "Asia/Seoul");
  assert.equal(evs.length, 3, "instances of one series are separate events");
  const r = evs.find((e) => e.start === Date.UTC(2026, 9, 7, 1, 0))!;
  assert.equal(r.title, "Review; budget, Q4");
  assert.equal(r.end - r.start, 90 * 60_000);
  assert.equal(r.location, "회의실 3");
  const h = evs.find((e) => e.title === "Holiday")!;
  assert.equal(h.allDay, true);
  assert.match(ics, /X-WR-CALNAME:팀\\, 공유 캘린더/);
});
