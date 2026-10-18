// End-to-end checks of the Today logic against a running server.
// usage: node scripts/e2e-today.mjs <baseUrl>
import { chromium } from "playwright";
import { isolateSync, openAddSheet } from "./grid-helpers.mjs";
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
await isolateSync(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const store = () => page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1") ?? "{}").state);
const step = async (name, fn) => {
  await fn();
  console.log("ok -", name);
};

await page.goto(base + "/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(800);

await step("add a plan via + sheet", async () => {
  await openAddSheet(page);
  await page.getByPlaceholder("Name").fill("Write report");
  await page.locator("select").first().selectOption({ label: "Work" });
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(300);
  const s = await store();
  assert.equal(s.plans.length, 1);
  assert.equal(s.plans[0].name, "Write report");
  assert.equal(s.plans[0].activityId, "work");
  await page.getByText("Write report").first().waitFor();
});

await step("a past plan is a dashed tentative actual; confirm it as planned", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const now = Date.now();
    raw.state.plans.push({
      id: "past", name: "Walk", activityId: "exercise", color: "#e3933a", allDay: false,
      start: now - 3 * 3600e3, end: now - 2 * 3600e3, repeat: "never", reminder: "activity",
      endConfirmation: "on", createdAt: 0,
    });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  // dispatch: a flag placed at this time of day may sit on top of it
  await page.locator('[data-column="actual"] [data-pending][title="Walk"]').first().dispatchEvent("click");
  await page.getByRole("button", { name: "Done as planned" }).click();
  await page.waitForTimeout(300);
  const s = await store();
  const a = s.actuals.find((x) => x.planKey?.startsWith("past@"));
  assert.ok(a, "confirmation creates a linked actual");
  assert.equal(a.end - a.start, 3600e3);
});

await step("a to-do with a start and end is a block on the timeline but stays a to-do", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const d = new Date(Date.now() - 5 * 3600e3); d.setHours(0, 0, 0, 0);
    raw.state.todos = [{ id: "tt", name: "Draft slides", activityId: "work", color: "#2f7fd8", date: d.getTime(), time: 14 * 60, duration: 90, done: false, createdAt: 1 }];
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  const block = page.locator('[data-column="plan"] [data-todo-block][title="Draft slides"]');
  // two hour rows (more pieces if it overlaps the earlier "Walk" plan at this time of day)
  assert.ok((await block.count()) >= 2, "14:00–15:30 spans two hour rows");
  await block.first().click();
  assert.equal(await page.getByLabel("End time").inputValue(), "15:30");
  await page.getByLabel("End time").fill("16:00");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(300);
  const s = await store();
  assert.equal(s.todos[0].duration, 120);
  assert.equal(s.plans.filter((p) => p.name === "Draft slides").length, 0, "not turned into a plan");
  // pull the end handle one 10-minute cell to the left: 14:00–15:50
  {
    const blk = page.locator('[data-column="plan"] [data-todo-block][title="Draft slides"]').last();
    const h = await blk.locator('[data-drag-handle="end"]').boundingBox();
    const col = await page.locator('[data-column="plan"]').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 - col.width / 6, h.y + h.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const t = (await store()).todos[0];
    assert.equal(t.time, 14 * 60, "start kept");
    assert.equal(t.duration, 110, "end dragged 10 minutes earlier");
  }
  await page.getByLabel("Mark done").first().click();
  assert.equal((await store()).todos[0].done, true, "checkbox on the block completes it");
});

await step("a plain click on the Plan column makes a 1-minute plan, drawn as a point", async () => {
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  const b = await page.locator('[data-column="plan"]').boundingBox();
  // the first free :30 spot from 06:00 (earlier test plans sit at times that depend on the clock)
  const row = await page.evaluate((b) => {
    const col = document.querySelector('[data-column="plan"]');
    for (let r = 1; r < 16; r++) {
      const el = document.elementFromPoint(b.x + b.width * 0.5 + 2, b.y + r * 30 + 15);
      if (el === col || el?.dataset?.empty) return r;
    }
    return -1;
  }, b);
  assert.ok(row > 0, "a free spot");
  await page.mouse.click(b.x + b.width * 0.5 + 2, b.y + row * 30 + 15);
  await page.getByText("Add plan").waitFor();
  await page.getByPlaceholder("Name").fill("Call mom");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(300);
  const p = (await store()).plans.find((x) => x.name === "Call mom");
  assert.equal(p.end - p.start, 60e3, "1 minute");
  assert.equal(new Date(p.start).getHours() * 60 + new Date(p.start).getMinutes(), ((5 + row) % 24) * 60 + 30);
  assert.equal(await page.locator('[data-column="plan"] [data-plan][data-point][title^="Call mom"]').count(), 1);
});

await step("timer start/stop records an actual", async () => {
  await page.getByRole("button", { name: "Timer" }).click();
  await page.getByRole("button", { name: "Reading" }).click();
  await page.evaluate(() => {
    // backdate the running timer by 20 minutes
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    raw.state.timer.start -= 20 * 60e3;
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  await page.getByText(/^Reading$/).last().waitFor();
  // tapping the running timer asks first (it used to stop on the spot)
  await page.getByLabel("Timer options").click();
  assert.equal((await store()).timer !== null, true, "still running after the tap");
  await page.locator("[data-timer-menu]").getByText("Stop & record").click();
  await page.waitForTimeout(300);
  const s = await store();
  assert.equal(s.timer, null);
  const r = s.actuals.find((x) => x.activityId === "reading");
  assert.ok(r && r.end - r.start >= 20 * 60e3 - 5000, "timer actual ~20m");
  const auto = s.todos.find((t) => t.fromActual === r.id);
  assert.ok(auto && auto.done, "an unplanned actual goes in as a done task");
  assert.equal(r.todoId, auto.id);
});

await step("record from a plan (at another time) links the actual", async () => {
  await openAddSheet(page);
  await page.getByRole("button", { name: "Actual", exact: true }).click();
  await page.getByText("Record from a plan").click();
  await page.getByText("Write report").last().click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(300);
  const s = await store();
  const plan = s.plans.find((p) => p.name === "Write report");
  const a = s.actuals.find((x) => x.planKey?.startsWith(plan.id + "@"));
  assert.ok(a, "actual linked to plan occurrence");
  assert.equal(a.activityId, "work");
});

await step("edit and delete a plan", async () => {
  await page.locator('[data-plan][title^="Write report"]').first().click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await page.waitForTimeout(300);
  const s = await store();
  assert.ok(!s.plans.some((p) => p.name === "Write report"));
  assert.ok(s.actuals.every((a) => !a.planKey || !a.planKey.includes("Write")), "links cleared");
});

await step("Start/End pills open the native pickers (desktop browsers need showPicker)", async () => {
  await page.evaluate(() => {
    window.__pickers = [];
    HTMLInputElement.prototype.showPicker = function () {
      window.__pickers.push(this.type);
    };
  });
  await openAddSheet(page);
  await page.getByRole("button", { name: "Actual", exact: true }).click();
  const start = page.locator("label.pill-input", { hasText: /AM|PM/ }).first();
  await start.click();
  await page.locator("label.pill-input", { hasText: /Today|Yesterday|\// }).first().click();
  assert.deepEqual(await page.evaluate(() => window.__pickers), ["time", "date"]);
  // and a picked value lands in the field
  await start.locator('input[type="time"]').fill("06:15");
  assert.match(await start.innerText(), /6:15/);
  await page.getByRole("button", { name: "Cancel" }).first().click();
});

await step("Adjust time: drag the lifted block on the timeline, then Save", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const d = new Date(Date.now() - 5 * 3600e3); d.setHours(0, 0, 0, 0);
    const st = d.getTime() + 5 * 3600e3 + 20 * 60e3; // 05:20–06:00 (always in the past)
    raw.state.plans.push({ id: "adj", name: "Stretch", activityId: "exercise", color: "#e3933a", allDay: false, start: st, end: st + 40 * 60e3, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: 0 });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  await page.locator('[data-column="actual"] [data-pending][title="Stretch"]').first().click();
  await page.getByText("Adjust time…").click();
  const blk = page.locator('[data-column="actual"] [data-adjusting]').first();
  const b = await blk.boundingBox();
  const col = await page.locator('[data-column="actual"]').boundingBox();
  // move it 10 minutes later (one cell to the right)
  await page.mouse.move(b.x + 20, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 20 + col.width / 6, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  // a tap outside the lifted block and the bar applies it
  await page.mouse.click(20, 20);
  await page.waitForTimeout(150);
  const s = await store();
  const a = s.actuals.find((x) => x.planKey?.startsWith("adj@"));
  assert.ok(a, "saved as the plan's actual");
  const d = new Date(a.start);
  assert.equal(d.getHours() * 60 + d.getMinutes(), 5 * 60 + 30, "moved 10 minutes later");
  assert.equal(a.end - a.start, 40 * 60e3, "same length");
  assert.equal(await page.locator("[data-adjust-dim]").count(), 0);
});

await step("a to-do with a time range is a dashed tentative actual too; confirming checks it off", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const d = new Date(Date.now() - 5 * 3600e3); d.setHours(0, 0, 0, 0);
    raw.state.todos.push({ id: "tblk", name: "Draft outline", activityId: "work", color: "#2f7fd8", date: d.getTime(), time: 5 * 60 + 10, duration: 30, done: false, createdAt: 9 });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  await page.locator('[data-column="actual"] [data-pending][title="Draft outline"]').first().click();
  await page.getByRole("button", { name: "Done as planned" }).click();
  await page.waitForTimeout(200);
  const s = await store();
  const a = s.actuals.find((x) => x.todoId === "tblk");
  assert.ok(a, "recorded, linked to the to-do");
  assert.equal(a.end - a.start, 30 * 60e3);
  assert.equal(s.todos.find((t) => t.id === "tblk").done, true, "to-do checked off");
  assert.equal(s.todos.filter((t) => t.name === "Draft outline").length, 1, "no extra automatic task");
  assert.equal(await page.locator('[data-column="actual"] [data-pending][title="Draft outline"]').count(), 0);
});

await step("a timer on a to-do doesn't hide its dashed block (working on it doesn't need a timer)", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const d = new Date(Date.now() - 5 * 3600e3); d.setHours(0, 0, 0, 0);
    raw.state.todos.push({ id: "tlong", name: "Long task", activityId: "work", color: "#2f7fd8", date: d.getTime(), time: 5 * 60, duration: 23 * 60, done: false, createdAt: 10 });
    raw.state.timer = { activityId: "work", name: "Long task", color: "#2f7fd8", todoId: "tlong", start: Date.now() - 60e3, targetEnd: Date.now() + 24 * 60e3 };
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  assert.ok((await page.locator('[data-column="actual"] [data-pending][title="Long task"]').count()) > 0, "still dashed while the pomodoro runs");
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    raw.state.timer = null;
    raw.state.todos = raw.state.todos.filter((t) => t.id !== "tlong");
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(500);
});

await step("pomodoros only add: absorbed inside the to-do's planned time, the extra shows, confirming takes the union", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const d = new Date(Date.now() - 5 * 3600e3); d.setHours(0, 0, 0, 0);
    const m = (h, mi) => d.getTime() + (h * 60 + mi) * 60e3;
    raw.state.todos.push({ id: "tu", name: "Union task", activityId: "work", color: "#2f7fd8", date: d.getTime(), time: 6 * 60, duration: 60, done: false, createdAt: 11 });
    // a pomodoro 6:40–7:05 on it: 6:40–7:00 inside the plan, 7:00–7:05 extra
    raw.state.actuals.push({ id: "pu", name: "Union task", activityId: "work", color: "#2f7fd8", start: m(6, 40), end: m(7, 5), todoId: "tu", createdAt: 1 });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  const solid = page.locator('[data-column="actual"] [data-actual][title="Union task"]');
  assert.equal(await solid.count(), 1, "only the extra 7:00–7:05 is drawn as its own block");
  const b = await solid.first().boundingBox();
  const col = await page.locator('[data-column="actual"]').boundingBox();
  assert.ok(b.width < col.width / 6, `a 5-minute sliver (${b.width}px)`);
  assert.ok((await page.locator('[data-column="actual"] [data-pending][title="Union task"]').count()) > 0, "the planned hour stays dashed");
  await page.locator('[data-column="actual"] [data-pending][title="Union task"]').first().click();
  await page.getByRole("button", { name: "Done as planned" }).click();
  await page.waitForTimeout(200);
  const st = await store();
  const mine = st.actuals.filter((a) => a.todoId === "tu");
  assert.equal(mine.length, 1, "merged into one record");
  const d = new Date(mine[0].start);
  assert.equal(d.getHours() * 60 + d.getMinutes(), 6 * 60);
  assert.equal(mine[0].end - mine[0].start, 65 * 60e3, "6:00–7:05: the plan ∪ the pomodoro");
});

await step("dragging a dashed tentative block goes straight to adjusting; Save records it", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const d = new Date(Date.now() - 5 * 3600e3); d.setHours(0, 0, 0, 0);
    raw.state.todos.push({ id: "tdrag", name: "Drag me", activityId: "work", color: "#2f7fd8", date: d.getTime(), time: 22 * 60, duration: 40, done: false, createdAt: 12 });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  // 22:00 — a stretch the other (clock-dependent) test blocks never reach
  const blk = page.locator('[data-column="actual"] [data-pending][title="Drag me"]').last(); // the end handle is on the last piece
  await blk.scrollIntoViewIfNeeded();
  const h = await blk.locator('[data-drag-handle="end"]').boundingBox();
  const col = await page.locator('[data-column="actual"]').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + col.width / 6, h.y + h.height / 2, { steps: 6 }); // end 10 min later
  await page.mouse.up();
  await page.locator("[data-adjust-bar]").waitFor();
  assert.match(await page.locator("[data-adjust-bar]").innerText(), /10:00 PM – 10:50 PM/);
  // Enter applies it (no need to press Save)
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.equal(await page.locator("[data-adjust-bar]").count(), 0, "applied and closed");
  const st = await store();
  const a = st.actuals.find((x) => x.todoId === "tdrag");
  assert.ok(a && a.end - a.start === 50 * 60e3, "recorded 22:00–22:50");
});

await step("pause / resume an in-progress plan: done part recorded, the rest dashed again", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const st = Math.floor((Date.now() - 30 * 60e3) / 60e3) * 60e3;
    // earlier steps leave items around "now"; at some hours they'd stack 3+ deep and fold Focus into "+n"
    const clear = (x) => !(x.start < st + 90 * 60e3 && x.end > st);
    raw.state.plans = raw.state.plans.filter((p) => p.repeat !== "never" || clear(p));
    raw.state.actuals = raw.state.actuals.filter(clear);
    raw.state.todos = raw.state.todos.filter((t) => t.time === undefined);
    raw.state.plans.push({ id: "pz", name: "Focus", activityId: "work", color: "#2f7fd8", allDay: false, start: st, end: st + 90 * 60e3, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: 0 });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  const focus = () => page.locator('[data-column="actual"] [data-pending][title^="Focus"]');
  await focus().first().dispatchEvent("click"); // (the now marker may sit on it)
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(200);
  let s = await store();
  const done = s.actuals.find((a) => a.planKey?.startsWith("pz@"));
  assert.ok(done && Math.abs(done.end - done.start - 30 * 60e3) <= 60e3, "the 30 minutes so far are recorded");
  assert.equal(s.plans.find((p) => p.id === "pz").runs[String(done.start)].paused, true);
  assert.ok((await focus().count()) > 0, "the rest is still dashed");
  assert.match(await focus().first().getAttribute("title"), /paused/);
  // resume, then finish: the remainder is recorded from the resume
  await focus().first().dispatchEvent("click"); // (the now marker may sit on it)
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForTimeout(200);
  s = await store();
  assert.equal(s.plans.find((p) => p.id === "pz").runs[String(done.start)].paused, false);
  await focus().first().dispatchEvent("click"); // (the now marker may sit on it)
  await page.getByRole("button", { name: "Done as planned" }).click();
  await page.waitForTimeout(200);
  s = await store();
  assert.equal(s.actuals.filter((a) => a.planKey?.startsWith("pz@")).length, 2, "two stretches recorded");
  assert.equal(await focus().count(), 0, "nothing tentative left");
});

await step("pause a confirmed actual that runs past now; move a dashed block without confirming", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const st = Math.floor((Date.now() - 20 * 60e3) / 60e3) * 60e3;
    raw.state.actuals.push({ id: "live", name: "Writing", activityId: "work", color: "#2f7fd8", start: st, end: st + 60 * 60e3, todoId: "x-none", createdAt: 1 });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  await page.locator('[data-column="actual"] [data-actual][title="Writing"]').first().dispatchEvent("click");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(200);
  let s = await store();
  const a = s.actuals.find((x) => x.id === "live");
  assert.ok(a.end <= Date.now() + 60e3 && a.end - a.start >= 19 * 60e3, "ends now");
  assert.ok(a.rest && a.rest.paused && a.rest.end - a.start === 60 * 60e3, "the rest is kept, dashed");
  const rest = page.locator('[data-column="actual"] [data-pending][title^="Writing"]');
  assert.ok((await rest.count()) > 0, "rest shown dashed");
  await rest.first().dispatchEvent("click");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForTimeout(200);
  s = await store();
  assert.equal(s.actuals.find((x) => x.id === "live").rest.paused, false);
  // drag that dashed rest and choose "Move only": still dashed, just moved
  const h = await rest.last().locator('[data-drag-handle="end"]').boundingBox();
  const col = await page.locator('[data-column="actual"]').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - col.width / 6, h.y + h.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.locator("[data-adjust-bar]").getByRole("button", { name: "Move only" }).click();
  await page.waitForTimeout(200);
  s = await store();
  const r = s.actuals.find((x) => x.id === "live").rest;
  assert.ok(r && r.end < a.start + 60 * 60e3, "rest end moved earlier, still not confirmed");
  assert.equal(s.actuals.filter((x) => x.name === "Writing").length, 1, "no new record");
  await page.waitForTimeout(600);
});

await step("1-minute items are flags; an actual flag drags to a new time", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const d = new Date(Date.now() - 5 * 3600e3); d.setHours(0, 0, 0, 0);
    const t = d.getTime() + (8 * 60 + 20) * 60e3; // 08:20
    raw.state.actuals.push({ id: "flag", name: "Call", activityId: "work", color: "#2f7fd8", start: t, end: t + 60e3, todoId: "none", createdAt: 1 });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  const flag = page.locator('[data-column="actual"] [data-actual][data-point][title^="Call"]');
  assert.equal(await flag.count(), 1);
  assert.equal(await flag.locator("svg .flag-wave").count(), 1, "drawn as a flag");
  const b = await flag.boundingBox();
  const col = await page.locator('[data-column="actual"]').boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 2 + col.width / 6, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const a = (await store()).actuals.find((x) => x.id === "flag");
  const d = new Date(a.start);
  assert.equal(d.getHours() * 60 + d.getMinutes(), 8 * 60 + 30, "moved 10 minutes later");
  await page.waitForTimeout(600);
});

await step("a flag near the end of the row flies to the left (room for its name)", async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const d = new Date(Date.now() - 5 * 3600e3); d.setHours(0, 0, 0, 0);
    const t = d.getTime() + (8 * 60 + 50) * 60e3; // 08:50
    raw.state.actuals.push({ id: "late-flag", name: "Commute home", activityId: "commute", color: "#30b0c7", start: t, end: t + 60e3, todoId: "none", createdAt: 1 });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(800);
  const f = page.locator('[data-column="actual"] [data-actual][data-point][title^="Commute home"]');
  assert.equal(await f.getAttribute("data-flip"), "");
  assert.doesNotMatch(await f.innerText(), /…/);
  const col = await page.locator('[data-column="actual"]').boundingBox();
  const fb = await f.boundingBox();
  assert.ok(fb.x > col.x && fb.x + fb.width <= col.x + col.width + 2, "stays inside the column");
});

await step("Ctrl+Z undoes the last edit, Ctrl+Shift+Z redoes it", async () => {
  await page.waitForTimeout(600); // taps right after a drag are ignored for a moment
  const before = (await store()).plans.length;
  await page.evaluate(() => {
    // a real edit through the store (as the UI does)
    const btn = document.querySelector('[data-column="plan"] [data-plan]');
    if (btn) btn.click();
  });
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await page.waitForTimeout(300);
  assert.equal((await store()).plans.length, before - 1);
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  assert.equal((await store()).plans.length, before, "undo restores the deleted plan");
  await page.locator("[data-undo-toast]").waitFor();
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(200);
  assert.equal((await store()).plans.length, before - 1, "redo deletes it again");
});

assert.deepEqual(errors, [], "no page errors");
console.log("all Today e2e checks passed");
await browser.close();
