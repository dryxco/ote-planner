// Swiping the timeline left/right changes the day; vertical scroll and long-press moves are unaffected.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { at, isolateSync, plan, pointOf, seed, store } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await isolateSync(ctx);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: p.x, y: p.y }] });
async function gesture(from, to, { hold = 0, steps = 8, pause = 16, shot } = {}) {
  await touch("touchStart", from);
  if (hold) await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    await page.waitForTimeout(pause);
    if (shot && i === Math.floor(steps / 2) && out) await page.screenshot({ path: `${out}/${shot}.png` });
  }
  await touch("touchEnd");
  await page.waitForTimeout(650);
}
await seed(page, base, { plans: [plan("p", "Focus", "work", "#2f7fd8", at(9), at(10))] });
const header = () => page.locator("header button").first().innerText();
const startDay = (await header()).slice(0, 5);
const mid = await pointOf(page, "plan", 12, 30);

await gesture(mid, { x: mid.x - 40, y: mid.y }); // small: snaps back
assert.equal((await header()).slice(0, 5), startDay);
console.log("ok - small swipe snaps back");

await gesture(mid, { x: mid.x - 220, y: mid.y + 6 }, { shot: "dayswipe_mid" });
const next = (await header()).slice(0, 5);
assert.notEqual(next, startDay, "swipe left -> next day");
console.log(`ok - swipe left: ${startDay} -> ${next}`);

await gesture(mid, { x: mid.x + 220, y: mid.y });
assert.equal((await header()).slice(0, 5), startDay, "swipe right -> back");
console.log("ok - swipe right goes back");

// vertical scroll still scrolls and doesn't change the day
const before = await page.evaluate(() => document.querySelector("[data-timeline-scroll]").scrollTop);
await gesture(mid, { x: mid.x + 10, y: mid.y - 200 });
const after = await page.evaluate(() => document.querySelector("[data-timeline-scroll]").scrollTop);
assert.ok(after > before, "scrolled");
assert.equal((await header()).slice(0, 5), startDay);
console.log("ok - vertical scroll unaffected");

// long-press move of a block still works (and doesn't swipe the day)
await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
await page.waitForTimeout(150);
await gesture(await pointOf(page, "plan", 9, 30), await pointOf(page, "plan", 10, 30), { hold: 450 });
const s = await store(page);
assert.deepEqual([s.plans[0].start, s.plans[0].end], [at(10), at(11)]);
assert.equal((await header()).slice(0, 5), startDay);
console.log("ok - long-press block move unaffected");
console.log("dayswipe e2e passed");
await browser.close();
