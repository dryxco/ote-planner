// Unfinished to-dos roll over to No date; their planned day shows them struck (red ✕, gray → once
// done later). Today / Calendar get a "Today" button when another day is shown.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { isolateSync, midnight } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await isolateSync(ctx);
const today = midnight();
const yday = today - 86400e3;
await ctx.addInitScript((y) => {
  if (localStorage.getItem("sync-store-v1")) return;
  localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: { todos: [
    { id: "late", name: "Fix the footer", activityId: "work", color: "#2f7fd8", date: y, time: 600, duration: 60, done: false, createdAt: y + 3600e3 },
    { id: "after", name: "Logged afterwards", activityId: "work", color: "#2f7fd8", date: y, done: false, createdAt: y + 3 * 86400e3 },
  ] } }));
}, yday);
const page = await ctx.newPage();
await page.goto(base + "/");
await page.locator("[data-tasks-panel]").waitFor();
await page.waitForTimeout(1500);
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
let s = await state();
const late = s.todos.find((t) => t.id === "late");
assert.equal(late.date, undefined, "rolled over to No date");
assert.equal(late.time, undefined);
assert.deepEqual(late.missed, [yday]);
assert.equal(s.todos.find((t) => t.id === "after").date, yday, "a to-do added to a past day afterwards stays there");
assert.match(await page.locator("[data-tasks-panel]").innerText(), /Carried over/);
assert.match(await page.locator('[data-tasks-panel] [data-task="late"]').innerText(), /↻/, "listed under Carried over with its day");
console.log("ok - unfinished to-dos roll over to No date");

// planned again for today (e.g. dragged onto today's timeline): still under Carried over, once
await page.evaluate((d) => {
  const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
  Object.assign(raw.state.todos.find((t) => t.id === "late"), { date: d, time: 14 * 60, duration: 30 });
  localStorage.setItem("sync-store-v1", JSON.stringify(raw));
}, today);
await page.reload();
await page.locator("[data-tasks-panel]").waitFor();
await page.waitForTimeout(500);
assert.equal(await page.locator('[data-tasks-panel] [data-task="late"]').count(), 1, "listed once");
assert.match(await page.locator("[data-tasks-panel]").innerText(), /Carried over[\s\S]*Fix the footer/);
console.log("ok - a carried-over task given a time again stays under Carried over");

// yesterday: struck in red with ✕
await page.locator(`[data-day="${yday}"]:not([aria-hidden="true"])`).first().click();
await page.waitForTimeout(300);
const row = page.locator('[data-tasks-panel] [data-missed="late"]');
await row.waitFor();
assert.match(await row.innerText(), /✕/);
const firstRows = await page.locator("[data-tasks-panel] [data-task], [data-tasks-panel] [data-missed]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task") ?? `missed:${e.getAttribute("data-missed")}`));
assert.equal(firstRows[0], "missed:late", "in its place in the day's list, not under Done");
assert.doesNotMatch(await page.locator("[data-tasks-panel]").innerText(), /Carried over/, "not carried over on the day itself");
// "Today" button brings the view back
await page.getByRole("button", { name: "Go to today" }).first().click();
await page.waitForTimeout(300);
assert.equal(await page.locator('[data-tasks-panel] [data-missed="late"]').count(), 0, "back on today");
// done today from Carried over -> it's in today's Done, and yesterday shows it gray with →
await page.locator('[data-tasks-panel] [data-task="late"]').getByLabel("Mark done").click();
await page.waitForTimeout(200);
const doneHeader = page.locator("[data-tasks-panel]").getByText(/^Done/);
await doneHeader.waitFor();
assert.equal(await page.locator('[data-tasks-panel] [data-task="late"]').count(), 1, "listed in today's Done");
await page.locator(`[data-day="${yday}"]:not([aria-hidden="true"])`).first().click();
await page.waitForTimeout(300);
assert.match(await page.locator('[data-tasks-panel] [data-missed="late"]').innerText(), /→/);
console.log("ok - the missed day shows ✕, then → once done");
console.log("rollover e2e passed");
await browser.close();
