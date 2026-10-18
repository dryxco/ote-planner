// Calendar (week): the To-dos cell holds only undated to-dos; selecting it lists undated then dated
// to-dos below; a selected day also lists its own to-dos.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { isolateSync, midnight } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
await isolateSync(ctx);
const day = midnight();
const todos = [
  { id: "u1", name: "Undated A", activityId: "work", color: "#2f7fd8", done: false, createdAt: 1 },
  { id: "d1", name: "Dated B", activityId: "work", color: "#2f7fd8", date: day, time: 600, done: false, createdAt: 2 },
];
await ctx.addInitScript((t) => {
  if (!localStorage.getItem("sync-store-v1")) localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: { todos: t } }));
}, todos);
const page = await ctx.newPage();
await page.goto(base + "/calendar");
await page.locator("[data-todo-cell]").waitFor();
const cell = await page.locator("[data-todo-cell]").innerText();
assert.match(cell, /Undated A/);
assert.doesNotMatch(cell, /Dated B/, "dated to-dos are not in the To-dos cell");
console.log("ok - To-dos cell shows only undated");

await page.locator("[data-todo-cell]").click();
const rows = await page.locator("[data-todo-list] [data-todo-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-todo-row")));
assert.deepEqual(rows, ["u1", "d1"], "undated first, then dated");
console.log("ok - selecting To-dos lists undated, then dated");

// selecting today's cell shows its to-do under the day's items
const d = new Date(day);
await page.getByText(String(d.getDate()), { exact: true }).first().click();
await page.locator("[data-day-todos]").waitFor();
assert.match(await page.locator("[data-day-todos]").innerText(), /Dated B/);
assert.equal(await page.locator("[data-todo-list]").count(), 0);
console.log("ok - a day lists its dated to-dos");
// a short diary note under the selected day; the Diary tab lists notes by date
await page.locator("[data-diary]").fill("Took a walk, read a book");
await page.locator("[data-diary]").blur();
await page.waitForTimeout(200);
const diary = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state.diary);
assert.equal(diary.length, 1);
assert.equal(diary[0].text, "Took a walk, read a book");
await page.goto(base + "/diary");
await page.locator("[data-diary-view]").waitFor();
assert.equal(await page.locator("[data-diary-view] [data-diary]").first().inputValue(), "Took a walk, read a book", "today's note on the Diary tab");
console.log("ok - diary note on the calendar and the Diary tab");
console.log("calendar to-dos e2e passed");
await browser.close();
