import { test } from "node:test";
import assert from "node:assert/strict";
import { feedMeta, icsAccountId, listIcsEvents, normalizeIcsUrl } from "./ics-subscriptions";

test("normalizeIcsUrl: webcal -> https; rejects http, local and private hosts", () => {
  assert.equal(normalizeIcsUrl("webcal://p01-calendars.icloud.com/published/2/abc"), "https://p01-calendars.icloud.com/published/2/abc");
  assert.equal(normalizeIcsUrl(" https://calendar.google.com/calendar/ical/x%40group/private-abc/basic.ics "), "https://calendar.google.com/calendar/ical/x%40group/private-abc/basic.ics");
  for (const bad of ["http://example.com/a.ics", "https://localhost/a.ics", "https://127.0.0.1/a.ics", "https://192.168.0.2/a.ics", "https://10.1.2.3/x", "not a url"]) {
    assert.throws(() => normalizeIcsUrl(bad), Error, bad);
  }
});

test("feedMeta reads calendar name and color", () => {
  const m = feedMeta("BEGIN:VCALENDAR\r\nX-WR-CALNAME:Team\\, shared\r\nX-APPLE-CALENDAR-COLOR:#ff9500\r\nEND:VCALENDAR");
  assert.deepEqual(m, { name: "Team, shared", color: "#ff9500" });
});

test("listIcsEvents fetches the feed once (cached) and maps events", async () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:1",
    "DTSTART:20261007T010000Z",
    "DTEND:20261007T020000Z",
    "SUMMARY:Standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(ics, { status: 200, headers: { "content-type": "text/calendar" } });
  }) as typeof fetch;
  try {
    const url = "https://calendar.example.com/feed.ics";
    const sub = { accountId: icsAccountId(url), url, name: "Feed", color: "#4285f4", addedAt: 0 };
    const range = { start: Date.UTC(2026, 9, 6), end: Date.UTC(2026, 9, 8) };
    const evs = await listIcsEvents(sub, range, "Asia/Seoul");
    await listIcsEvents(sub, range, "Asia/Seoul");
    assert.equal(calls, 1, "feed is cached");
    assert.equal(evs.length, 1);
    assert.equal(evs[0].title, "Standup");
    assert.equal(evs[0].provider, "ics");
    assert.equal(evs[0].start, Date.UTC(2026, 9, 7, 1));
  } finally {
    globalThis.fetch = orig;
  }
});
