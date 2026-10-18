// The selected day follows the real calendar: at the Day start time (05:00) "today" moves on,
// unless another date was picked on purpose.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { isolateSync } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
await isolateSync(ctx);
const page = await ctx.newPage();
await page.clock.install({ time: new Date(2026, 9, 7, 4, 50) }); // Oct 7, 04:50 -> still Oct 6's day
await page.goto(base + "/");
await page.evaluate(() => localStorage.clear());
await page.reload();
const header = () => page.locator("[data-today-date]").innerText();
await page.waitForFunction(() => document.querySelector("[data-today-date]")?.textContent?.includes("10.06"));
assert.match(await header(), /10\.06\s*Tue, Today/);
console.log("ok - 04:50 belongs to the previous day (Day start 05:00)");

await page.clock.fastForward("00:20:00"); // 05:10
await page.waitForFunction(() => document.querySelector("[data-today-date]")?.textContent?.includes("10.07"), null, { timeout: 5000 });
assert.match(await header(), /10\.07\s*Wed, Today/);
console.log("ok - at 05:00 the view moves to the new day");

// pick another day on purpose -> it stays there when the day rolls over
await page.getByRole("button", { name: "F 9", exact: true }).click();
assert.match(await header(), /10\.09/);
await page.clock.fastForward("24:00:00");
await page.waitForTimeout(500);
assert.match(await header(), /10\.09/);
console.log("ok - a date picked on purpose is kept");
console.log("day rollover e2e passed");
await browser.close();
