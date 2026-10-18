// Today grid: a plan in progress shows a dashed tentative actual until now; the now marker sits in
// the current hour row of the Actual column.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { plan, seed, isolateSync } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await (await (async () => { const c = await browser.newContext({ viewport: { width: 393, height: 852 } }); await isolateSync(c); return c; })()).newPage();
const start = Date.now() - 40 * 60e3;
await seed(page, base, { plans: [plan("o", "Deep work", "work", "#2f7fd8", start, start + 3600e3)] });
assert.ok((await page.locator('[data-column="actual"] [data-pending]').count()) >= 1, "dashed tentative actual");
assert.equal(await page.locator('[data-column="plan"] [data-pending]').count(), 0);
const nowEl = page.locator('[data-column="actual"] [data-now]');
assert.equal(await nowEl.count(), 1);
const hhmm = new Date().toTimeString().slice(0, 5);
assert.equal((await nowEl.innerText()).trim(), hhmm);
// a not-yet-started plan is mirrored as a dashed block too
// tapping the dashed block asks: as planned, or adjust? "Adjust time…" opens Add actual linked to the plan
await page.locator('[data-column="actual"] [data-pending]').first().click();
await page.locator("[data-confirm]").getByText("Done as planned").waitFor();
await page.getByText("Adjust time…").click();
// adjust mode: the timeline dims, the block is lifted and draggable; Details… opens the sheet
await page.locator("[data-adjust-dim]").waitFor();
const lifted = page.locator('[data-column="actual"] [data-adjusting]');
assert.ok((await lifted.count()) >= 1, "the block stays bright above the dim layer");
const endHandle = lifted.last().locator('[data-drag-handle="end"]');
const hb = await endHandle.boundingBox();
const colB = await page.locator('[data-column="actual"]').boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x + hb.width / 2 - colB.width / 6, hb.y + hb.height / 2, { steps: 6 }); // 10 minutes earlier
await page.mouse.up();
await page.waitForTimeout(150);
await page.getByRole("button", { name: "Details…" }).click();
await page.getByText("Add actual").waitFor();
assert.equal(await page.getByPlaceholder("Name").inputValue(), "Deep work");
assert.ok(await page.getByText("Deep work ·").count(), "Record from a plan shows the linked plan");
await page.getByRole("button", { name: "Cancel" }).first().click();
// "Done as planned" turns it into a confirmed (solid) actual ending at now
await page.locator('[data-column="actual"] [data-pending]').first().click();
await page.getByText("Done as planned").click();
await page.locator('[data-column="actual"] [data-actual]').first().waitFor();
assert.equal(await page.locator('[data-column="actual"] [data-pending]').count(), 0, "confirmed plan is no longer tentative");
const a = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1") ?? "{}").state?.actuals ?? []);
{
  assert.equal(a[0].name, "Deep work");
  assert.ok(a[0].end <= Date.now() + 3 * 60e3, "in-progress plan records only until now");
}
console.log("grid look e2e passed");
await browser.close();
