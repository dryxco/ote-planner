// Two devices (separate browser contexts) against a server with its own data dir:
// edits on one appear on the other; deletes propagate; first connect merges existing data.
// usage: node scripts/e2e-sync.mjs <baseUrl of a server started with SYNC_DATA_DIR=<tmp>>
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { at, plan, withTestSession, openAddSheet } from "./grid-helpers.mjs";

const base = process.argv[2];
if (!base) throw new Error("baseUrl required (use a throwaway server: SYNC_DATA_DIR=<tmp> next start -p <port>)");
const browser = await chromium.launch();
const device = async (seedState) => {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
  await withTestSession(ctx);
  if (seedState) {
    // data that existed on this device before sync: present before the app's first load
    await ctx.addInitScript((s) => {
      if (!localStorage.getItem("sync-store-v1")) localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: s }));
    }, seedState);
  }
  const page = await ctx.newPage();
  await page.goto(base + "/");
  return page;
};
const state = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1") ?? "{}").state ?? {});
const until = async (fn, msg, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout: " + msg);
};

// Device A already has local data from before sync existed
const A = await device({ plans: [plan("old", "Old local plan", "work", "#2f7fd8", at(9), at(10))] });
const B = await device();

await until(async () => (await state(B)).plans?.some((p) => p.id === "old"), "B receives A's existing local plan");
console.log("ok - first connect uploads existing local data");

// A edits via the UI (adds a plan), B sees it
await openAddSheet(A);
await A.getByPlaceholder("Name").fill("From A");
await A.getByRole("button", { name: "Save" }).click();
await until(async () => (await state(B)).plans?.some((p) => p.name === "From A"), "B sees plan created on A");
console.log("ok - A -> B");

// B renames an activity in settings-like way (store edit through UI: change day start in Settings)
await B.getByLabel("Settings").click();
await B.locator("select").nth(1).selectOption({ label: "6:00 AM" }); // 0 = Theme, 1 = Day start time
await until(async () => (await state(A)).settings?.dayStart === 360, "A sees B's settings change");
console.log("ok - B -> A (settings)");

// A deletes the old plan; B loses it
await A.keyboard.press("Escape");
await A.evaluate(() => {
  // delete through the app store so it goes through normal change tracking
  const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
  return raw.state.plans.length;
});
await A.locator('[data-plan][title="Old local plan"]').first().click().catch(() => {});
const del = A.getByRole("button", { name: "Delete" });
if (await del.count()) {
  await del.click();
  await A.getByRole("button", { name: "Tap again to delete" }).click();
}
await until(async () => !(await state(B)).plans?.some((p) => p.id === "old"), "B sees the delete");
console.log("ok - deletes propagate");

// a third device starting fresh gets everything, and its default data doesn't clobber edits
const C = await device();
await until(async () => {
  const s = await state(C);
  return s.settings?.dayStart === 360 && s.plans?.some((p) => p.name === "From A");
}, "new device C gets the full data");
await new Promise((r) => setTimeout(r, 1500));
assert.equal((await state(A)).settings.dayStart, 360, "fresh device's defaults did not overwrite settings");
console.log("ok - new device gets everything; its defaults don't overwrite");

console.log("sync e2e passed");
await browser.close();
