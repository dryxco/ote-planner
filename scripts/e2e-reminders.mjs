// A plan with a "5 min before" reminder shows an in-app banner when the moment passes.
import { chromium } from "playwright";
import { isolateSync } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await (await (async () => { const c = await browser.newContext({ viewport: { width: 393, height: 852 } }); await isolateSync(c); return c; })()).newPage();
await page.goto(base + "/");
await page.evaluate(() => {
  localStorage.clear();
  const now = Date.now();
  const start = now + 5 * 60e3 + 8e3; // reminder moment is ~8s from now
  localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: { plans: [{
    id: "r1", name: "Call mom", activityId: "other", color: "#5f5f64", allDay: false, start, end: start + 1800e3,
    repeat: "never", reminder: "5m", endConfirmation: "activity", createdAt: 0 }] } }));
});
await page.reload();
await page.getByText("Call mom in 5 min").waitFor({ timeout: 40_000 });
console.log("reminder banner e2e passed");
await browser.close();
