// Desktop pomodoro: start a 25-minute session on a task; when time is up it stops by itself and is
// recorded as an actual ending exactly at the target. Also checks the three-pane layout exists.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { isolateSync, midnight } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await isolateSync(ctx);
const todo = { id: "t1", name: "Write report", activityId: "work", color: "#2f7fd8", date: midnight(), done: false, createdAt: 1 };
await ctx.addInitScript((t) => {
  if (!localStorage.getItem("sync-store-v1")) localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: { todos: [t] } }));
}, todo);
const page = await ctx.newPage();
await page.clock.install();
await page.goto(base + "/");
await page.locator("[data-desktop-home]").waitFor();
for (const sel of ["[data-tasks-panel]", "[data-pomodoro]", '[data-column="plan"]']) assert.equal(await page.locator(sel).count(), 1, sel);
assert.equal(await page.locator('[data-task="t1"]').count(), 1, "task listed");
console.log("ok - three-pane desktop layout");

// the task activity menu opens downward and sets the new task's activity
{
  const btn = await page.getByLabel("Task activity").boundingBox();
  await page.getByLabel("Task activity").click();
  const menu = await page.getByRole("menu").boundingBox();
  assert.ok(menu.y >= btn.y + btn.height, "menu opens below the button");
  await page.getByRole("menuitem", { name: "Work" }).click();
  await page.getByPlaceholder("Add task").fill("Menu task");
  await page.keyboard.press("Enter");
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
  assert.equal(st.todos.find((x) => x.name === "Menu task").activityId, "work");
  console.log("ok - task activity menu");
  // reorder by dragging a row onto another (no handle)
  const names = () => page.locator("[data-tasks-panel] [data-task]").evaluateAll((els) => els.map((e) => e.innerText.split("\n")[0]));
  assert.deepEqual((await names()).slice(0, 2), ["Write report", "Menu task"]);
  const wr = page.locator("[data-tasks-panel] [data-task]").first();
  await page.locator("[data-tasks-panel] [data-task]").nth(1).dragTo(wr, { targetPosition: { x: 40, y: 4 } });
  await page.waitForTimeout(200);
  assert.deepEqual((await names()).slice(0, 2), ["Menu task", "Write report"], "dragged above");
  console.log("ok - reorder tasks by dragging");
}

// drag a task from the list onto the timeline: it gets that time (as a 1-hour block) and stays a to-do
{
  const col = page.locator('[data-column="plan"]');
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  const b = await col.boundingBox();
  await page.locator('[data-task="t1"]').dragTo(col, { targetPosition: { x: b.width * 0.5, y: 30 * 2 + 15 } }); // row 2 = 07:xx, half = :30
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
  const t = st.todos.find((x) => x.id === "t1");
  assert.equal(t.time, 7 * 60 + 30, "dropped at 7:30");
  assert.equal(t.duration, 60);
  assert.equal(st.plans.length, 0, "not a plan");
  assert.equal(await page.locator('[data-column="plan"] [data-todo-block][title="Write report"]').count(), 2, "7:30–8:30 spans two rows");
  console.log("ok - drag a task onto the timeline");
  // onto the Actual column instead: recorded as done, not planned
  await page.getByPlaceholder("Add task").fill("Did it anyway");
  await page.keyboard.press("Enter");
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state.todos.find((x) => x.name === "Did it anyway").id);
  const acol = page.locator('[data-column="actual"]');
  const ab = await acol.boundingBox();
  await page.locator(`[data-task="${id}"]`).dragTo(acol, { targetPosition: { x: 4, y: 30 * 1 + 15 } }); // 06:00
  await page.waitForTimeout(300);
  const st2 = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
  const t2 = st2.todos.find((x) => x.id === id);
  assert.equal(t2.time, undefined, "not given a planned time");
  assert.equal(t2.done, true, "checked off");
  const a2 = st2.actuals.find((x) => x.todoId === id);
  assert.ok(a2 && a2.end - a2.start === 3600e3, "recorded as an actual");
  assert.equal(await page.locator(`[data-column="plan"] [data-todo-block][title="Did it anyway"]`).count(), 0, "nothing on the Plan side");
  void ab;
  console.log("ok - drag a task onto Actual: recorded, not planned");
  // …and dragging that record off the timeline takes it out again (the task is open again)
  {
    await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
    const blk = await page.locator('[data-column="actual"] [data-actual][title="Did it anyway"]').first().boundingBox();
    const tasks = await page.locator("[data-tasks-panel]").boundingBox();
    const from = { x: blk.x + blk.width / 2, y: blk.y + blk.height / 2 };
    const to = { x: tasks.x + tasks.width / 2, y: tasks.y + 250 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const st3 = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
    assert.equal(st3.actuals.filter((x) => x.todoId === id).length, 0, "record removed");
    assert.equal(st3.todos.find((x) => x.id === id).done, false, "task open again");
    console.log("ok - drag an actual off the timeline: removed");
  }
}

// and back: drag a plan from the timeline onto the task list -> it becomes a timed to-do
{
  await page.evaluate((m) => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const st = m + 9 * 3600e3;
    raw.state.plans = [{ id: "pl", name: "Plan to task", activityId: "work", color: "#2f7fd8", allDay: false, start: st, end: st + 3600e3, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: 0 }];
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  }, midnight());
  await page.reload();
  await page.locator("[data-desktop-home]").waitFor();
  await page.waitForTimeout(800);
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  const blk = await page.locator('[data-column="plan"] [data-plan][title="Plan to task"]').first().boundingBox();
  const tasks = await page.locator("[data-tasks-panel]").boundingBox();
  await page.mouse.move(blk.x + blk.width / 2, blk.y + blk.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(blk.x + blk.width / 2 + ((tasks.x + tasks.width / 2 - blk.x - blk.width / 2) * i) / 12, blk.y + blk.height / 2 + ((tasks.y + 200 - blk.y - blk.height / 2) * i) / 12);
  assert.equal(await page.locator("[data-tasks-panel][data-drop-over]").count(), 1, "task list highlights as a drop target");
  await page.mouse.up();
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
  assert.equal(st.plans.length, 0, "plan removed");
  const t = st.todos.find((x) => x.name === "Plan to task");
  assert.ok(t, "to-do created");
  assert.equal(t.time, 9 * 60);
  assert.equal(t.duration, 60);
  console.log("ok - drag a plan onto the task list");
}

// a task scheduled over this moment is listed first and preselected
{
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const m = Math.floor((Date.now() - d.getTime()) / 60000) - 5;
    raw.state.todos.push({ id: "nowt", name: "Now task", activityId: "work", color: "#2f7fd8", date: d.getTime(), time: m, duration: 30, done: false, createdAt: 99 });
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.locator("[data-pomodoro]").waitFor();
  const opts = await page.getByLabel("Select task").locator("option").allInnerTexts();
  // (other test tasks may also cover this moment, depending on the time of day)
  const nowOpts = opts.slice(1).filter((o) => o.endsWith("(now)"));
  assert.ok(nowOpts.includes("● Now task (now)") && opts.slice(1, 1 + nowOpts.length).every((o) => o.endsWith("(now)")), opts.join(" | "));
  assert.ok((await page.getByLabel("Select task").inputValue()).startsWith("todo:"), "a task for right now is preselected");
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    raw.state.todos = raw.state.todos.filter((t) => t.id !== "nowt");
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.locator("[data-pomodoro]").waitFor();
  console.log("ok - tasks for right now come first");
}
await page.getByLabel("Select task").selectOption({ label: "Write report" });
const t0 = await page.evaluate(() => Date.now());
await page.getByRole("button", { name: "Start", exact: true }).click();
await page.waitForTimeout(200);
let s = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
assert.equal(s.timer?.name, "Write report");
assert.equal(s.timer.targetEnd - s.timer.start, 25 * 60e3);

await page.clock.fastForward("26:00");
await page.waitForTimeout(1500);
s = await page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);
assert.equal(s.timer, null, "stopped itself");
const a = s.actuals.find((x) => x.name === "Write report");
assert.ok(a, "recorded as an actual");
assert.equal(a.end - a.start, 25 * 60e3, "exactly 25 minutes, not the 26 that passed");
assert.ok(a.start >= t0);
assert.equal(a.todoId, "t1", "the session is linked to its to-do");
// t1 has planned time (it was dropped on the timeline above): the pomodoro only adds to it — the
// to-do is confirmed from its dashed block, not finished by the session
assert.equal(s.todos.find((x) => x.id === "t1").done, false, "a planned to-do stays open");
console.log("ok - pomodoro stops at 25:00 and records exactly 25 minutes");
// it can be hidden (a small pill remains) and brought back; the choice survives a reload
await page.getByLabel("Hide pomodoro").click();
assert.equal(await page.locator("[data-pomodoro]").count(), 0, "hidden");
await page.reload();
await page.locator("[data-pomodoro-show]").click();
await page.locator("[data-pomodoro]").waitFor();
const h = (await page.locator("[data-pomodoro]").boundingBox()).height;
assert.ok(h < 120, `compact (${h}px)`);
console.log("ok - pomodoro hides and shows, compact");
// the Today tab on a computer is just Today (Home is the three-pane view)
await page.getByRole("link", { name: "Today" }).click();
await page.waitForURL("**/today");
await page.locator('[data-column="plan"]').waitFor();
assert.equal(await page.locator("[data-desktop-home]").count(), 0, "no three-pane on Today");
assert.equal(await page.locator("[data-pomodoro], [data-pomodoro-show], [data-tasks-panel]").count(), 0);
await page.getByRole("link", { name: "Home" }).click();
await page.locator("[data-desktop-home]").waitFor();
console.log("ok - Home vs Today tabs on desktop");

// desktop: the entry sheet's time pill opens the app's own picker (not the browser's)
{
  await page.evaluate(() => (document.querySelector("[data-timeline-scroll]").scrollTop = 0));
  const b = await page.locator('[data-column="plan"]').boundingBox();
  await page.mouse.click(b.x + b.width * 0.93, b.y + 3 * 30 + 15); // ~08:55
  await page.getByText("Add plan").waitFor();
  await page.getByRole("button", { name: "Time", exact: true }).first().click();
  await page.locator("[data-time-picker]").waitFor();
  await page.getByRole("listbox", { name: "Hour" }).getByRole("option", { name: "10" }).click();
  await page.getByRole("listbox", { name: "Minute" }).getByRole("option", { name: "15" }).click();
  assert.equal((await page.getByRole("button", { name: "Time", exact: true }).first().innerText()).trim(), "10:15 AM");
  // …and the day pill opens the app's own month grid
  await page.getByRole("button", { name: "Day", exact: true }).first().click();
  await page.locator("[data-date-picker]").waitFor();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.locator("[data-date-picker] [role=gridcell]").filter({ hasText: /^15$/ }).first().click();
  assert.equal(await page.locator("[data-date-picker]").count(), 0, "closes after picking");
  assert.match(await page.getByRole("button", { name: "Day", exact: true }).first().innerText(), /\d/);
  await page.getByRole("button", { name: "Cancel" }).first().click();
  console.log("ok - custom time picker on desktop");
}

// dragging the dial to 3 o'clock sets 15 minutes
const dial = await page.locator("[data-dial]").boundingBox();
const cx = dial.x + dial.width / 2, cy = dial.y + dial.height / 2;
await page.mouse.move(cx, dial.y + 4);
await page.mouse.down();
await page.mouse.move(cx + dial.width / 2 - 4, cy, { steps: 6 });
await page.mouse.up();
assert.match(await page.locator("[data-pomodoro]").innerText(), /15:00/);
console.log("ok - drag the dial to set minutes");

// the pomodoro grows by dragging its top edge up: a big centred timer, remembered per device
{
  const pomo = page.locator("[data-pomodoro]");
  const before = { card: await pomo.boundingBox(), dial: await page.locator("[data-dial]").boundingBox(), time: await page.locator("[data-pomodoro-time]").boundingBox() };
  const fs0 = await page.locator("[data-pomodoro-time]").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const hb = await page.locator("[data-pomodoro-resize]").boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 250, { steps: 10 });
  await page.mouse.up();
  const card = await pomo.boundingBox();
  assert.ok(Math.abs(card.height - before.card.height - 250) < 4, `card grew by 250 (${before.card.height} -> ${card.height})`);
  assert.ok((await page.locator("[data-tasks-panel]").boundingBox()).height >= 160, "tasks keep room");
  const fs1 = await page.locator("[data-pomodoro-time]").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  assert.ok(fs1 >= 48 && fs1 >= fs0 * 2, `time text larger (${fs0} -> ${fs1})`);
  const dial = await page.locator("[data-dial]").boundingBox();
  assert.ok(dial.width >= before.dial.width * 2, `dial larger (${before.dial.width} -> ${dial.width})`);
  assert.ok(Math.abs(dial.x + dial.width / 2 - (card.x + card.width / 2)) < 2, "dial centred");
  await page.reload();
  await page.locator("[data-pomodoro]").waitFor();
  assert.ok(Math.abs((await pomo.boundingBox()).height - card.height) < 2, "height remembered");
  // the dial still sets minutes at the big size: 6 o'clock = 30 minutes
  const d = await page.locator("[data-dial]").boundingBox();
  const dcx = d.x + d.width / 2, dcy = d.y + d.height / 2;
  await page.mouse.move(dcx + 4, d.y + 6);
  await page.mouse.down();
  await page.mouse.move(dcx + d.width / 2 - 6, dcy, { steps: 6 });
  await page.mouse.move(dcx + 2, d.y + d.height - 6, { steps: 6 });
  await page.mouse.up();
  assert.match(await page.locator("[data-pomodoro-time]").innerText(), /30:00/);
  // the tasks never get squeezed below 160px, however far it is dragged
  const hb2 = await page.locator("[data-pomodoro-resize]").boundingBox();
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + 4);
  await page.mouse.down();
  await page.mouse.move(hb2.x + hb2.width / 2, 0, { steps: 10 });
  await page.mouse.up();
  assert.ok((await page.locator("[data-tasks-panel]").boundingBox()).height >= 159, "tasks ≥ 160px");
  // double-click the edge: back to the compact card
  await page.locator("[data-pomodoro-resize]").dblclick();
  assert.ok((await pomo.boundingBox()).height < 120, "reset to compact");
  assert.equal(await page.evaluate(() => localStorage.getItem("sync-pomodoro-height")), null);
  console.log("ok - pomodoro resizes into a big timer and remembers");
}

// panes resize by dragging the gutters, and the size is remembered
const w0 = (await page.locator('[data-pane="right"]').boundingBox()).width;
const g = await page.locator('[data-resize="right"]').boundingBox();
await page.mouse.move(g.x + g.width / 2, g.y + 200);
await page.mouse.down();
await page.mouse.move(g.x + g.width / 2 - 120, g.y + 200, { steps: 8 });
await page.mouse.up();
const w1 = (await page.locator('[data-pane="right"]').boundingBox()).width;
assert.ok(Math.abs(w1 - w0 - 120) < 4, `right pane grew by 120 (${w0} -> ${w1})`);
await page.reload();
await page.locator("[data-desktop-home]").waitFor();
assert.ok(Math.abs((await page.locator('[data-pane="right"]').boundingBox()).width - w1) < 2, "remembered");
console.log("ok - panes resize and remember");
console.log("pomodoro e2e passed");
await browser.close();
