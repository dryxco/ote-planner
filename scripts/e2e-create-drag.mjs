// Press and drag on empty grid space: a 5-minute-snapped selection follows the pointer through the
// grid; releasing opens Add plan (left) / Add actual (right) with that range.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mouseDrag, pointOf, scrollTimelineTop, seed, isolateSync } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3];
const browser = await chromium.launch();
const startEnd = async (page) => [
  await page.locator("label.pill-input").nth(1).innerText(),
  await page.locator("label.pill-input").nth(3).innerText(),
];
async function open(touchMode) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: touchMode, isMobile: touchMode });
  await isolateSync(ctx);
await isolateSync(ctx);
  const page = await ctx.newPage();
  await seed(page, base, {});
  return { ctx, page };
}

{
  const { ctx, page } = await open(false);
  const a = await pointOf(page, "plan", 9, 1);
  const b = await pointOf(page, "plan", 10, 29);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  assert.ok((await page.locator("[data-selection]").count()) >= 2, "selection wraps across rows");
  if (out) await page.screenshot({ path: `${out}/create_drag.png` });
  await page.mouse.up();
  await page.getByText("Add plan").waitFor();
  assert.deepEqual(await startEnd(page), ["9:00 AM", "10:30 AM"]);
  console.log("ok - mouse drag in Plan: 9:00–10:30");
  // switching to To-dos keeps the picked range: saved as a to-do at 9:00–10:30
  await page.getByRole("button", { name: "To-dos", exact: true }).click();
  await page.getByPlaceholder("Name", { exact: true }).fill("Ranged task");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(200);
  const t = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state.todos.find((x) => x.name === "Ranged task"));
  assert.ok(t && t.date !== undefined, "dated");
  assert.equal(t.time, 9 * 60, "time kept");
  assert.equal(t.duration, 90, "length kept");
  console.log("ok - ...and switching to To-dos keeps that time");
  await ctx.close();
}
{
  const { ctx, page } = await open(false);
  // early-morning range: always in the past (actuals are capped at "now")
  await mouseDrag(page, await pointOf(page, "actual", 6, 40), await pointOf(page, "actual", 5, 15));
  await page.getByText("Add actual").waitFor();
  assert.deepEqual(await startEnd(page), ["5:15 AM", "6:40 AM"]);
  console.log("ok - upward drag in Actual: 5:15–6:40");
  await ctx.close();
}
{
  const { ctx, page } = await open(true);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: p.x, y: p.y }] });
  const gesture = async (from, to, hold) => {
    await touch("touchStart", from);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 });
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await page.waitForTimeout(300);
  };
  await gesture(await pointOf(page, "plan", 12), await pointOf(page, "plan", 8), 0);
  assert.equal(await page.getByText("Add plan").count(), 0, "a quick swipe does not open the sheet");
  console.log("ok - touch swipe scrolls");
  await scrollTimelineTop(page);
  await gesture(await pointOf(page, "plan", 13, 0), await pointOf(page, "plan", 14, 30), 450);
  await page.getByText("Add plan").waitFor();
  assert.deepEqual(await startEnd(page), ["1:00 PM", "2:30 PM"]);
  console.log("ok - touch long press + drag: 1:00–2:30 PM");
  await ctx.close();
}
console.log("create-drag e2e passed");
await browser.close();
