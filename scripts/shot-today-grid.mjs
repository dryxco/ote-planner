// Screenshot of Today recreating the reference scene from the original app (mocked calendar events).
// usage: node scripts/shot-today-grid.mjs <baseUrl> <out.png>
import { chromium } from "playwright";
import { isolateSync } from "./grid-helpers.mjs";

const [base = "http://localhost:3000", out = "today-grid.png"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await (async () => { const c = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 }); await isolateSync(c); return c; })()).newPage();
const t0 = new Date();
t0.setHours(0, 0, 0, 0);
const at = (h, m = 0) => t0.getTime() + (h * 60 + m) * 60e3;
const ev = (id, title, s, e) => ({ id: `google:me:p:${id}:${s}`, calendarId: "google:me:p", provider: "google", title, start: s, end: e, allDay: false, color: "#4285f4" });
await page.route("**/api/calendar/events**", (r) =>
  r.fulfill({ json: { events: [ev("a", "Investor meeting", at(10), at(11)), ev("b", "Design seminar", at(10, 30), at(12, 30)), ev("c", "Team all-hands", at(21), at(22))] } }),
);
const now = new Date();
const planStart = Date.now() - 40 * 60e3 - (Date.now() % (5 * 60e3)); // in progress, like 19:40 at 20:19
await page.goto(base + "/");
await page.evaluate((p) => {
  localStorage.clear();
  localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: { plans: [p] } }));
}, { id: "o", name: "", activityId: "other", color: "#5f5f64", allDay: false, start: planStart, end: planStart + 3600e3, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: 0 });
await page.reload();
await page.waitForTimeout(1200);
await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 4 * 30 - 6));
await page.waitForTimeout(150);
await page.screenshot({ path: out });
console.log(out, now.toTimeString().slice(0, 5));
await browser.close();
