// Seeds demo data and captures phone-sized screenshots of each tab.
// usage: node scripts/shots.mjs <baseUrl> <outDir> [path...]
import { chromium } from "playwright";
import { isolateSync } from "./grid-helpers.mjs";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:3000", out = "shots", ...paths] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const today = new Date();
today.setHours(0, 0, 0, 0);
const at = (h, m = 0, dayOffset = 0) => today.getTime() + dayOffset * 86400000 + (h * 60 + m) * 60000;
const P = (id, name, act, color, s, e, extra = {}) => ({
  id, name, activityId: act, color, allDay: false, start: s, end: e, repeat: "never",
  reminder: "activity", endConfirmation: "activity", createdAt: 0, ...extra,
});
const A = (id, name, act, color, s, e, extra = {}) => ({ id, name, activityId: act, color, start: s, end: e, createdAt: 0, ...extra });

const state = {
  state: {
    plans: [
      P("p1", "Deep work", "work", "#2f7fd8", at(9), at(11, 30)),
      P("p2", "Lunch", "meal", "#c9a046", at(12), at(13)),
      P("p3", "Gym", "exercise", "#e3933a", at(18), at(19), { endConfirmation: "on" }),
      P("p4", "Read", "reading", "#3cb563", at(21, 30), at(22, 30)),
      P("p5", "Sleep", "sleep", "#76767c", at(23, 30), at(7, 0, 1), { repeat: "daily", start: at(23, 30, -10), end: at(7, 0, -9) }),
      P("p6", "Standup", "work", "#2f7fd8", at(10), at(10, 30)),
    ],
    actuals: [
      A("a1", "Deep work", "work", "#2f7fd8", at(9, 20), at(11, 40)),
      A("a2", "Lunch", "meal", "#c9a046", at(12, 10), at(13, 0)),
      A("a3", "Email", "work", "#2f7fd8", at(14), at(15, 30)),
    ],
    todos: [],
    goals: [],
    timer: null,
  },
  version: 1,
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await isolateSync(ctx);
await ctx.addInitScript((s) => {
  if (!localStorage.getItem("sync-store-v1")) localStorage.setItem("sync-store-v1", s);
}, JSON.stringify(state));
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
for (const p of paths.length ? paths : ["/", "/calendar", "/review", "/activities", "/goals"]) {
  const [path, action] = p.split("#");
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  if (action) {
    for (const step of action.split(";")) {
      if (step.startsWith("click=")) await page.getByText(step.slice(6), { exact: true }).first().click();
      else if (step.startsWith("label=")) await page.getByLabel(step.slice(6)).first().click();
      else if (step.startsWith("sel=")) await page.locator(step.slice(4)).first().click();
      await page.waitForTimeout(450);
    }
  }
  const name = (p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "today");
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
}
await browser.close();
