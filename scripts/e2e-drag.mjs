// Drag plan/actual blocks on the Today grid (mouse): move and resize, snapped to 5 minutes.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { at, mouseDrag, plan, pointOf, seed, store, isolateSync } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3];
const browser = await chromium.launch();
const page = await (await (async () => { const c = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 }); await isolateSync(c); return c; })()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await seed(page, base, {
  plans: [plan("p", "Focus", "work", "#2f7fd8", at(9), at(10))],
  actuals: [{ id: "a", name: "Gym", activityId: "exercise", color: "#e3933a", start: at(11), end: at(12), createdAt: 0 }],
});

// move: grab at 9:20, drop at 9:55 (same row, +35 min) -> 9:35-10:35
await mouseDrag(page, await pointOf(page, "plan", 9, 20), await pointOf(page, "plan", 9, 55));
let s = await store(page);
assert.deepEqual([s.plans[0].start, s.plans[0].end], [at(9, 35), at(10, 35)]);
assert.equal(await page.getByText("Plan · Work").count(), 0, "drag does not open the editor");
console.log("ok - move within the row (+35 min)");

// move down one row: grab 10:00 -> drop 11:00 -> 10:35-11:35
await mouseDrag(page, await pointOf(page, "plan", 10, 10), await pointOf(page, "plan", 11, 10));
s = await store(page);
assert.deepEqual([s.plans[0].start, s.plans[0].end], [at(10, 35), at(11, 35)]);
console.log("ok - move down one row (+1h)");

// resize end via the end handle (right edge of the last segment) to 12:10
const endHandle = page.locator('[data-plan] [data-drag-handle="end"]');
let hb = await endHandle.boundingBox();
const p1210 = await pointOf(page, "plan", 12, 10);
await mouseDrag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, p1210);
s = await store(page);
assert.deepEqual([s.plans[0].start, s.plans[0].end], [at(10, 35), at(12, 10)]);
console.log("ok - resize end across rows");

// resize start via start handle to 10:00
const startHandle = page.locator('[data-plan] [data-drag-handle="start"]').first();
hb = await startHandle.boundingBox();
await mouseDrag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, await pointOf(page, "plan", 10, 0));
s = await store(page);
assert.deepEqual([s.plans[0].start, s.plans[0].end], [at(10), at(12, 10)]);
console.log("ok - resize start");
if (out) await page.screenshot({ path: `${out}/drag_after.png` });

// move actual up one row -> 10:00-11:00
// (it shares the row with the plan's tentative block, so grab the actual's own band)
{
  const ab = await page.locator('[data-column="actual"] [data-actual]').first().boundingBox();
  const from = { x: ab.x + ab.width / 2, y: ab.y + ab.height / 2 };
  await mouseDrag(page, from, { x: from.x, y: from.y - 30 });
}
s = await store(page);
assert.deepEqual([s.actuals[0].start, s.actuals[0].end], [at(10), at(11)]);
console.log("ok - move actual");

// a plain click still opens the editor
await page.locator("[data-plan]").first().click();
await page.getByText("Plan · Work").waitFor();
console.log("ok - click opens editor");

assert.deepEqual(errors, []);
console.log("drag e2e passed");
await browser.close();
