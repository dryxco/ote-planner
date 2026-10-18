// Week strip follows the finger and glides to the next/previous week; small drags snap back.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { isolateSync } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await isolateSync(ctx);
const page = await ctx.newPage();
await page.clock.install({ time: new Date(2026, 9, 7, 12, 0) });
await page.goto(base + "/");
await page.waitForFunction(() => document.querySelector("[data-today-date]")?.textContent?.includes("October 7"));
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
const header = () => page.locator("[data-today-date]").innerText();
const dayBtn = await page.getByRole("button", { name: "W 7", exact: true }).boundingBox();
const stripY = dayBtn.y + dayBtn.height / 2;

async function swipe(dx, steps = 8, pause = 16, shotAt) {
  await touch("touchStart", 300, stripY);
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", 300 + (dx * i) / steps, stripY + 2);
    await page.waitForTimeout(pause);
    if (shotAt && i === shotAt && out) await page.screenshot({ path: `${out}/weekstrip_mid.png`, clip: { x: 0, y: 100, width: 393, height: 150 } });
  }
  await touch("touchEnd");
  await page.waitForTimeout(450);
}

await swipe(-60); // small drag: snaps back
assert.match(await header(), /October 7\b/);
console.log("ok - small drag snaps back");

await swipe(-220, 8, 16, 4); // past 25%: next week, same weekday
assert.match(await header(), /October 14\b/);
console.log("ok - swipe left goes to next week (October 14)");

await swipe(80, 3, 8); // quick flick right
assert.match(await header(), /October 7\b/);
console.log("ok - flick right goes back (October 7)");

await page.getByRole("button", { name: "F 9", exact: true }).click();
assert.match(await header(), /October 9\b/);
console.log("ok - tapping a day still selects it");
console.log("weekstrip e2e passed");
await browser.close();
