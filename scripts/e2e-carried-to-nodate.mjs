// Drag a Carried over to-do into No date (onto a row, or onto the collapsed heading): it leaves
// Carried over for good, while the day it was missed still shows it struck.
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
  const td = (id, o) => ({ id, name: id, activityId: "work", color: "#2f7fd8", done: false, createdAt: y - 86400e3, ...o });
  localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: { todos: [
    td("carried-a", { missed: [y] }),
    td("carried-b", { missed: [y] }),
    td("undated", {}),
  ] } }));
}, yday);
const page = await ctx.newPage();
await page.goto(base + "/");
await page.locator("[data-tasks-panel]").waitFor();
await page.waitForTimeout(1500);
const panel = page.locator("[data-tasks-panel]");
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
const section = async (id) => {
  const text = await panel.innerText();
  const at = text.indexOf(id);
  return at > text.indexOf("No date") ? "no date" : at > text.indexOf("Carried over") ? "carried" : "?";
};

// No date starts collapsed: drop onto its heading
await page.locator('[data-task="carried-a"]').dragTo(page.locator("[data-no-date-head]"));
await page.waitForTimeout(200);
let s = await state();
let a = s.todos.find((t) => t.id === "carried-a");
assert.equal(a.date, undefined);
assert.equal(a.settled, yday);
assert.deepEqual(a.missed, [yday], "missed day kept");
await page.locator("[data-no-date-head]").click();
await page.waitForTimeout(200);
assert.equal(await section("carried-a"), "no date");
assert.doesNotMatch(await page.locator('[data-task="carried-a"]').innerText(), /↻/);
console.log("ok - dropped on the No date heading");

// onto a No date row
await page.locator('[data-task="carried-b"]').dragTo(page.locator('[data-task="undated"]'), { targetPosition: { x: 20, y: 4 } });
await page.waitForTimeout(200);
assert.doesNotMatch(await panel.innerText(), /Carried over/, "nothing left carried over");
const order = await panel.locator("[data-task]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task")));
assert.ok(order.indexOf("carried-b") < order.indexOf("undated"), "placed before the row it was dropped on");
console.log("ok - dropped onto a No date row");

// the missed day still shows them struck
await page.locator(`[data-day="${yday}"]:not([aria-hidden="true"])`).first().click();
await page.waitForTimeout(300);
assert.equal(await panel.locator("[data-missed]").count(), 2);
console.log("ok - still struck on the day they were missed");
console.log("carried-to-nodate e2e passed");
await browser.close();
