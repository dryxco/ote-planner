// ⌘↵ in an editor sheet does what its Save button does (here: the to-do sheet).
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { isolateSync, midnight } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await isolateSync(ctx);
await ctx.addInitScript((d) => {
  if (localStorage.getItem("sync-store-v1")) return;
  localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: { todos: [{ id: "t", name: "first", activityId: "work", color: "#2f7fd8", date: d, done: false, createdAt: d }] } }));
}, midnight());
const page = await ctx.newPage();
await page.goto(base + "/");
await page.locator('[data-tasks-panel] [data-task="t"]').waitFor();
await page.waitForTimeout(1000);
await page.locator('[data-tasks-panel] [data-task="t"]').getByText("first").click();
const sheet = page.getByRole("dialog");
await sheet.waitFor();
const name = sheet.locator("input").first();
await name.fill("second");
await name.press("Meta+Enter");
await sheet.waitFor({ state: "detached" });
const s = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
assert.equal(s.todos.find((t) => t.id === "t").name, "second");
console.log("ok - ⌘↵ saves the to-do sheet and closes it");
await browser.close();
