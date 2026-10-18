// A device holding an older copy can't undo what another device did (10/10: to-dos checked off on
// one device came back unchecked). A is offline while B checks a to-do off; A, still showing it
// unchecked, renames it; back online, the to-do is renamed AND still checked, on both.
// usage: node scripts/e2e-stale-device.mjs <baseUrl of a throwaway server (OTE_DATA_DIR=<tmp>)>
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { midnight, withTestSession } from "./grid-helpers.mjs";

const base = process.argv[2];
if (!base) throw new Error("baseUrl required");
const browser = await chromium.launch();
const day = midnight();
const device = async (seed) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await withTestSession(ctx);
  if (seed) await ctx.addInitScript((s) => localStorage.getItem("sync-store-v1") || localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: s })), seed);
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.locator("[data-tasks-panel]").waitFor();
  return { ctx, page };
};
const todo = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1") ?? "{}").state?.todos?.find((t) => t.id === "c"));
const until = async (fn, msg, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout: " + msg);
};

const A = await device({ todos: [{ id: "c", name: "contact", activityId: "work", color: "#2f7fd8", date: day, done: false, createdAt: day }] });
const B = await device();
await until(async () => !!(await todo(B.page)), "B gets the to-do");

await A.ctx.setOffline(true);
await B.page.locator('[data-task="c"]').getByLabel("Mark done").click();
await until(async () => (await todo(B.page))?.done === true, "B checked it");
await new Promise((r) => setTimeout(r, 1500)); // B's push lands

// A still shows it unchecked, and renames it
assert.equal((await todo(A.page)).done, false);
await A.page.locator('[data-task="c"]').getByText("contact").click();
const name = A.page.getByRole("dialog").locator("input").first();
await name.fill("contact page");
await name.press("Meta+Enter");
await A.ctx.setOffline(false);
await A.page.evaluate(() => window.dispatchEvent(new Event("online")));

for (const [who, d] of [["A", A], ["B", B]])
  await until(async () => {
    const t = await todo(d.page);
    return t?.name === "contact page" && t.done === true;
  }, `${who}: renamed and still checked`);
console.log("ok - an older copy's edit keeps the check made on another device");
await browser.close();
