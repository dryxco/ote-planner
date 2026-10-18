// Touch on the Today grid: a quick swipe on a block scrolls; long press then drag moves it.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { at, plan, pointOf, scrollTimelineTop, seed, store, isolateSync } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
await isolateSync(ctx);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: p.x, y: p.y }] });
async function gesture(from, to, holdMs) {
  await touch("touchStart", from);
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= 8; i++) {
    await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 });
    await page.waitForTimeout(16);
  }
  await touch("touchEnd");
  await page.waitForTimeout(300);
}
await seed(page, base, { plans: [plan("p", "Focus", "work", "#2f7fd8", at(9), at(10))] });

const p930 = await pointOf(page, "plan", 9, 30);
await gesture(p930, { x: p930.x, y: p930.y - 120 }, 0);
let s = await store(page);
assert.deepEqual([s.plans[0].start, s.plans[0].end], [at(9), at(10)], "swipe does not drag");
assert.ok((await page.evaluate(() => document.querySelector("[data-timeline-scroll]").scrollTop)) > 0, "swipe scrolled");
console.log("ok - quick swipe scrolls");

await scrollTimelineTop(page);
await gesture(await pointOf(page, "plan", 9, 30), await pointOf(page, "plan", 10, 30), 450);
s = await store(page);
assert.deepEqual([s.plans[0].start, s.plans[0].end], [at(10), at(11)]);
console.log("ok - long press + drag moves the plan down one row");
console.log("touch drag e2e passed");
await browser.close();
