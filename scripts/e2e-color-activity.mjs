// In the entry sheet, colors and activities are linked both ways.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { isolateSync, seed, openAddSheet } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
await isolateSync(ctx);
const page = await ctx.newPage();
await seed(page, base, {});
await openAddSheet(page);
const activity = page.locator("label", { has: page.locator("select") }).first();
await page.getByLabel("color #3cb563").click(); // green
assert.match(await activity.innerText(), /Reading/);
await page.getByLabel("color #2f7fd8").click(); // blue
assert.match(await activity.innerText(), /Work/);
await page.locator("select").first().selectOption({ label: "Exercise" });
assert.equal(await page.getByLabel("color #e3933a").locator("svg").count(), 1, "activity -> its color is selected");
// any color via the custom picker: picking one that no activity owns keeps the activity
await page.locator("[data-custom-color]").first().fill("#ff00aa");
assert.match(await activity.innerText(), /Exercise/);
assert.equal(await page.getByLabel("Custom color").locator("svg").count(), 1, "custom color selected");
console.log("ok - custom color in the entry sheet");

// an activity's color can be set to anything; its records still wearing the old color follow
await page.getByRole("button", { name: "Cancel" }).first().click();
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
  const t = Date.now() - 3600e3;
  raw.state.plans = [
    { id: "p1", name: "Run", activityId: "exercise", color: "#e3933a", allDay: false, start: t, end: t + 1800e3, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: 0 },
    { id: "p2", name: "Swim", activityId: "exercise", color: "#123456", allDay: false, start: t, end: t + 1800e3, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: 0 },
  ];
  localStorage.setItem("sync-store-v1", JSON.stringify(raw));
});
await page.goto(base + "/activities");
await page.getByText("Exercise", { exact: true }).first().click();
await page.locator("[data-custom-color]").first().fill("#00c7be");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForTimeout(300);
const st = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
assert.equal(st.activities.find((a) => a.id === "exercise").color, "#00c7be");
assert.equal(st.plans.find((p) => p.id === "p1").color, "#00c7be", "plan in the old activity color follows");
assert.equal(st.plans.find((p) => p.id === "p2").color, "#123456", "custom-colored plan keeps its color");
console.log("ok - activity custom color, records follow");
// drag the handle to reorder: Sleep (1st) dragged down two rows lands 3rd; Other stays last
await page.getByRole("button", { name: "Cancel" }).first().click().catch(() => {});
await page.goto(base + "/activities");
const h = await page.locator('[data-reorder="sleep"]').boundingBox();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
await page.mouse.down();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 100, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(200);
const order = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("sync-store-v1")).state.activities.sort((a, b) => a.order - b.order).map((a) => a.id),
);
assert.equal(order[2], "sleep", order.join(","));
assert.equal(order.at(-1), "other");
assert.equal(await page.locator("[data-activity-row]").first().getAttribute("data-activity-row"), order[0]);
console.log("ok - drag to reorder activities");
// a slow, long drag keeps working (no freeze, no duplicated rows) and edit-mode delete needs two taps
{
  const h2 = await page.locator('[data-reorder="sleep"]').boundingBox();
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2 - (100 / 30) * i);
  const rowsDuring = await page.locator("[data-activity-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-activity-row")));
  assert.equal(new Set(rowsDuring).size, rowsDuring.length, "no duplicated rows while dragging");
  await page.mouse.up();
  await page.waitForTimeout(200);
  const ord = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state.activities.sort((a, b) => a.order - b.order).map((a) => a.id));
  assert.equal(ord[0], "sleep", "dragged back to the top: " + ord.join(","));
  assert.equal(new Set(ord).size, ord.length);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Delete Reading", { exact: true }).click();
  let n = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state.activities.length);
  assert.ok(await page.getByLabel("Confirm delete Reading").count(), "first tap only arms");
  assert.ok(n >= 8);
  await page.getByLabel("Confirm delete Reading").click();
  n = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state.activities.some((a) => a.id === "reading"));
  assert.equal(n, false, "second tap deletes");
  console.log("ok - long drag stays smooth; delete needs two taps");
}
console.log("color <-> activity e2e passed");
await browser.close();
