// Ghost calendar events: shown in both columns, tap -> prefilled Add plan / Add actual.
// The events API is mocked; real Google/iCloud accounts are not needed.
import { chromium } from "playwright";
import { isolateSync } from "./grid-helpers.mjs";
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await isolateSync(ctx);
const page = await ctx.newPage();
const t0 = new Date(Date.now() - 5 * 3600e3); // the app's logical day starts at 05:00
t0.setHours(0, 0, 0, 0);
const at = (h, m = 0) => t0.getTime() + (h * 60 + m) * 60e3;
const ev = (id, title, s, e, extra = {}) => ({
  id: `google:me:primary:${id}:${s}`, calendarId: "google:me:primary", provider: "google",
  title, start: s, end: e, allDay: false, color: "#4285f4", ...extra,
});
const events = [
  ev("a", "Investor meeting", at(10), at(11)),
  ev("b", "Design seminar", at(10, 30), at(12, 30)),
  ev("c", "Team all-hands", at(21), at(22)),
  ev("d", "Public holiday", t0.getTime(), t0.getTime() + 86400e3, { allDay: true }),
  ev("e", "All day tomorrow", t0.getTime() + 86400e3, t0.getTime() + 2 * 86400e3, { allDay: true }),
];
await page.route("**/api/calendar/events**", (r) => r.fulfill({ json: { events } }));
await page.route("**/api/calendar/calendars", (r) => r.fulfill({ json: { accounts: [{ provider: "google", accountId: "me", label: "me" }], calendars: [{ id: "google:me:primary", provider: "google", accountId: "me", name: "Primary", color: "#4285f4" }] } }));
await page.goto(base + "/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1000);
if (out) await page.screenshot({ path: `${out}/today_ghosts.png` });

// all-day events: today's shows, tomorrow's (starting at 00:00, inside today's 05:00–05:00 day) doesn't
assert.equal(await page.getByText("Public holiday").count(), 1);
assert.equal(await page.getByText("All day tomorrow").count(), 0, "tomorrow's all-day event must not appear today");
console.log("ok - all-day events follow calendar dates");

// ghosts show in both columns (also in the future); the seminar 10:30-12:30 wraps over 3 hour rows
// (in the Actual column an event is a dashed tentative actual until confirmed)
const ghostIn = (side) => page.locator(`[data-column="${side}"] [${side === "plan" ? "data-ghost" : "data-pending"}][title^="Design seminar"]`);
assert.equal(await ghostIn("plan").count(), 3);
assert.equal(await ghostIn("actual").count(), 3);

await ghostIn("plan").first().click();
await page.getByText("Add plan").waitFor();
assert.equal(await page.getByPlaceholder("Name").inputValue(), "Design seminar");
// which calendar it comes from
await page.locator("[data-from-calendar]", { hasText: "From Primary · Google" }).waitFor();
assert.equal(await page.locator('[data-column="plan"] [data-ghost][title="Design seminar — Primary · Google"]').count(), 3, "tooltip names the calendar");
console.log("ok - an event shows which calendar it's from");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForTimeout(300);
const s = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
assert.equal(s.plans.length, 1);
assert.equal(s.plans[0].sourceEventId, events[1].id);
assert.equal(s.plans[0].start, events[1].start);
// the plan replaces the ghost in the Plan column; the Actual column now mirrors the plan
assert.equal(await ghostIn("plan").count(), 0);
assert.equal(await page.locator('[data-column="plan"] [data-plan][title="Design seminar"]').count(), 3);
assert.equal(await ghostIn("actual").count(), 3);
// deleting a plan made from an event must not bring the event's ghost back (the "shell" bug)
await page.locator('[data-column="plan"] [data-plan][title="Design seminar"]').first().click();
await page.getByRole("button", { name: "Delete" }).click();
await page.getByRole("button", { name: "Tap again to delete" }).click();
await page.waitForTimeout(300);
assert.equal(await page.locator('[data-column="plan"] [data-plan][title="Design seminar"]').count(), 0, "plan gone");
assert.equal(await ghostIn("plan").count(), 0, "no ghost left behind in the plan column");
assert.equal(await ghostIn("actual").count(), 0, "and not in the actual column");
console.log("ok - deleting a plan made from an event leaves no shell");

// "Hide this event" straight from a ghost
const allHands = (side) => page.locator(`[data-column="${side}"] [data-ghost][title^="Team all-hands"]`);
assert.ok((await allHands("plan").count()) > 0);
await allHands("plan").first().click();
await page.getByRole("button", { name: "Hide this event" }).click();
await page.waitForTimeout(300);
assert.equal(await allHands("plan").count(), 0);
assert.equal(await allHands("actual").count(), 0);
console.log("ok - Hide this event hides the ghost in both columns");

// restore from Settings
await page.getByLabel("Settings").click();
await page.getByText("Calendars shown").click();
await page.getByRole("button", { name: "Show again" }).click();
await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: "Close" }).click();
await page.waitForTimeout(300);
assert.ok((await allHands("plan").count()) > 0, "hidden events can be shown again");
console.log("ok - hidden events can be restored");
console.log("ghost events e2e passed");
await browser.close();
