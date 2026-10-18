// Takes the README screenshots (docs/screenshots/) from a THROWAWAY server filled by demo-data.mjs.
// Server: SYNC_DATA_DIR=<tmp> SYNC_BIND=127.0.0.1 npx next start -H 127.0.0.1 -p 3320
// usage: node scripts/demo-data.mjs http://127.0.0.1:3320 --weeks=3 && node scripts/readme-shots.mjs http://127.0.0.1:3320
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:3320";
const out = path.join(import.meta.dirname, "..", "docs", "screenshots");
mkdirSync(out, { recursive: true });

// two made-up calendar events (shown beside the plans)
const t0 = new Date();
t0.setHours(0, 0, 0, 0);
const at = (h, m = 0) => t0.getTime() + (h * 60 + m) * 60_000;
const ev = (id, title, s, e) => ({ id: `google:me:work:${id}:${s}`, calendarId: "google:me:work", provider: "google", title, start: s, end: e, allDay: false, color: "#4285f4" });
const calendar = async (ctx) => {
  await ctx.route("**/api/calendar/events**", (r) => r.fulfill({ json: { events: [ev("a", "Team sync", at(10), at(10, 30)), ev("b", "1:1 with Alex", at(16, 30), at(17))] } }));
  await ctx.route("**/api/calendar/calendars", (r) =>
    r.fulfill({ json: { accounts: [{ provider: "google", accountId: "me", label: "me@example.com" }], calendars: [{ id: "google:me:work", provider: "google", accountId: "me", name: "Work", color: "#4285f4" }] } }),
  );
};

const browser = await chromium.launch();
async function shot(name, { url, width, height, dark = false, before, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
  await calendar(ctx);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(base + url);
  await page.waitForTimeout(1500);
  if (before) await before(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  await ctx.close();
  console.log(`✓ ${name}.png`);
}

const phone = { width: 393, height: 852 };
const desk = { width: 1440, height: 900 };
const scrollTimeline = (h) => async (page) => {
  await page.evaluate((h) => {
    const el = document.querySelector("[data-timeline-scroll]");
    if (el) el.scrollTop = el.scrollHeight * h;
  }, h);
};

await shot("home-desktop", { url: "/", ...desk, before: scrollTimeline(0.08) });
await shot("home-desktop-dark", { url: "/", ...desk, dark: true, before: scrollTimeline(0.08) });
await shot("today", { url: "/today", ...phone, before: scrollTimeline(0.1) });
await shot("calendar", { url: "/calendar", ...phone });
const lastWeek = async (page) => {
  await page.getByLabel("Previous", { exact: true }).first().click();
};
await shot("review", { url: "/review", ...phone, before: lastWeek });
await shot("goals", { url: "/goals", ...phone, before: lastWeek });
await shot("projects", { url: "/projects", ...desk, before: (page) => page.getByText("Launch the beta").first().click() });
await shot("tickets", {
  url: "/",
  ...desk,
  before: async (page) => {
    await page.getByRole("tab", { name: /Tickets/ }).click();
  },
});
await shot("diary", { url: "/diary", ...desk, init: () => localStorage.setItem("sync-diary-view", "calendar") });
await browser.close();
