// Shared helpers for e2e scripts on the Today grid (row = hour, x = minutes).
export const ROW_H = 30;
export const DAY_START_H = 5;

/** Midnight of the app's logical "today" (the day rolls over at 05:00, like the app). */
export function midnight() {
  const t0 = new Date(Date.now() - DAY_START_H * 3600e3);
  t0.setHours(0, 0, 0, 0);
  return t0.getTime();
}
export const at = (h, m = 0) => midnight() + (h * 60 + m) * 60e3;

/** Viewport point for clock time h:m inside a column ("plan" | "actual"). */
export async function pointOf(page, side, h, m = 0) {
  const b = await page.locator(`[data-column="${side}"]`).boundingBox();
  const row = h - DAY_START_H + (h < DAY_START_H ? 24 : 0);
  return { x: b.x + (m / 60) * b.width, y: b.y + row * ROW_H + ROW_H / 2 };
}

/** Mouse drag between two points in a few steps. */
export async function mouseDrag(page, from, to, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

export async function scrollTimelineTop(page) {
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  await page.waitForTimeout(100);
}

export const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);

export async function seed(page, base, state) {
  await page.goto(base + "/");
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: s }));
  }, state);
  await page.reload();
  // the app lands on today and auto-scrolls to "now" after loading; let that settle first
  await page.waitForTimeout(1500);
  await scrollTimelineTop(page);
}

export const plan = (id, name, act, color, start, end, extra = {}) => ({
  id, name, activityId: act, color, allDay: false, start, end, repeat: "never",
  reminder: "activity", endConfirmation: "off", createdAt: 0, ...extra,
});

/** Keep tests off the real synced data: answer /api/sync locally for this browser context. */
export async function isolateSync(ctx) {
  await ctx.route("**/api/sync", (r) => r.fulfill({ json: { version: 0, changes: [] } }));
  await withTestSession(ctx);
}

/** Sign the context in with OTE_TEST_SESSION (from make-test-session.mjs) and OTE_TEST_BASE. */
export async function withTestSession(ctx) {
  const value = process.env.OTE_TEST_SESSION;
  if (!value) return;
  const url = process.env.OTE_TEST_BASE ?? "http://127.0.0.1:3000";
  await ctx.addCookies([{ name: "ote_session", value, url }]);
}

/** Open the new-entry sheet by clicking an empty spot of the Plan column (first free row from 07:00). */
export async function openAddSheet(page) {
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  const b = await page.locator('[data-column="plan"]').first().boundingBox();
  const pt = await page.evaluate(({ b, rowH }) => {
    const col = document.querySelector('[data-column="plan"]');
    for (let r = 2; r < 18; r++)
      for (const fx of [0.93, 0.1, 0.5]) {
        const x = b.x + b.width * fx, y = b.y + r * rowH + rowH / 2;
        if (y > innerHeight - 140) break;
        const el = document.elementFromPoint(x, y);
        if (el === col || el?.dataset?.empty) return { x, y };
      }
    return null;
  }, { b, rowH: ROW_H });
  if (!pt) throw new Error("no empty spot in the Plan column");
  await page.mouse.click(pt.x, pt.y);
  await page.getByText(/^Add (plan|actual|to-do)$/).first().waitFor();
}
