// Task branches: the branch icon duplicates a to-do (same details, its own time); titles show (n/m)
// once there are 2+; only main + direct children; the to-do sheet lists, adds and deletes branches.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { isolateSync, midnight } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await isolateSync(ctx);
const day = midnight();
await ctx.addInitScript((t) => {
  if (!localStorage.getItem("sync-store-v1")) localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: { todos: [t] } }));
}, { id: "m", name: "Outline", activityId: "work", color: "#2f7fd8", date: day, time: 13 * 60, duration: 60, done: false, createdAt: 1 });
const page = await ctx.newPage();
await page.goto(base + "/");
await page.locator("[data-tasks-panel]").waitFor();
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);

assert.equal(await page.locator("[data-tasks-panel] [data-branch-label]").count(), 0, "no (n/m) with a single branch");
await page.locator('[data-task="m"]').getByLabel("Branch this task").click();
let s = await state();
assert.equal(s.todos.length, 2);
const b2 = s.todos.find((t) => t.id !== "m");
assert.equal(b2.branchOf, "m");
assert.equal(b2.name, "Outline");
assert.equal(b2.date, day, "same day");
assert.equal(b2.time, undefined, "no time on a new branch");
// branching the branch still hangs off main (no grandchildren)
await page.locator(`[data-task="${b2.id}"]`).getByLabel("Branch this task").click();
s = await state();
assert.ok(s.todos.every((t) => t.id === "m" || t.branchOf === "m"), "only direct children");
const labels = await page.locator("[data-tasks-panel] [data-branch-label]").allInnerTexts();
assert.deepEqual([...labels].sort(), ["(1/3)", "(2/3)", "(3/3)"]);
// branches are listed right under their main, one step in
{
  const order = await page.locator("[data-tasks-panel] [data-task]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task")));
  assert.equal(order[0], "m");
  const mx = (await page.locator('[data-task="m"]').boundingBox()).x;
  const bx = (await page.locator(`[data-task="${order[1]}"]`).boundingBox()).x;
  assert.ok(bx - mx >= 20, `indented (${bx - mx}px)`);
}
console.log("ok - branch icon duplicates; (n/m) labels; one level only");

// the sheet lists branches; each branch's name is its own (the group stays), times stay independent
await page.locator('[data-task="m"]').getByText("Outline").click();
await page.locator("[data-branches]").waitFor();
assert.equal(await page.locator("[data-branch-row]").count(), 3);
assert.match(await page.locator('[data-branch-row="m"]').innerText(), /1\/3[\s\S]*Main[\s\S]*1:00 PM–2:00 PM/);
await page.getByPlaceholder("Name", { exact: true }).fill("Outline v2");
await page.getByRole("button", { name: "Save" }).click();
s = await state();
assert.equal(s.todos.find((t) => t.id === "m").name, "Outline v2");
assert.ok(s.todos.filter((t) => t.id !== "m").every((t) => t.name === "Outline"), "branches keep their names");
assert.ok(s.todos.filter((t) => t.id !== "m").every((t) => t.branchOf === "m"), "still branches of main");
assert.deepEqual([...(await page.locator("[data-tasks-panel] [data-branch-label]").allInnerTexts())].sort(), ["(1/3)", "(2/3)", "(3/3)"]);
assert.equal(s.todos.find((t) => t.id === "m").time, 13 * 60);
assert.equal(s.todos.filter((t) => t.time !== undefined).length, 1, "branches keep their own (no) time");
console.log("ok - names and times per branch; the group stays");

// add from the sheet, delete one (two taps), delete main -> first branch becomes main
await page.locator('[data-task="m"]').getByText("Outline v2").click();
await page.getByRole("button", { name: "Add branch" }).click();
assert.equal(await page.locator("[data-branch-row]").count(), 4);
await page.getByLabel("Delete branch 4").click();
await page.getByLabel("Confirm delete branch 4").click();
assert.equal(await page.locator("[data-branch-row]").count(), 3);
await page.getByLabel("Delete branch 1").click();
await page.getByLabel("Confirm delete branch 1").click(); // deleting the open one closes the sheet
await page.waitForTimeout(200);
s = await state();
assert.equal(s.todos.length, 2);
const heir = s.todos.find((t) => !t.branchOf);
assert.ok(heir && s.todos.find((t) => t.branchOf === heir.id), "first branch is the new main");
assert.deepEqual([...(await page.locator("[data-tasks-panel] [data-branch-label]").allInnerTexts())].sort(), ["(1/2)", "(2/2)"]);
console.log("ok - add / delete in the sheet; deleting main promotes the next");
// groups move together: a done main stays on top while a branch is open, and follows a branch to
// another day; once every branch is done, the main goes to Done too
{
  const day = midnight();
  await page.evaluate((d) => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    raw.state.todos = [
      { id: "g", name: "Group main", activityId: "work", color: "#2f7fd8", date: d, done: true, doneAt: 1, createdAt: 1 },
      { id: "g2", name: "Group branch 2", activityId: "work", color: "#2f7fd8", date: d, branchOf: "g", done: false, createdAt: 2 },
      { id: "g3", name: "Group branch 3", activityId: "work", color: "#2f7fd8", date: d + 86400e3, branchOf: "g", done: false, createdAt: 3 },
    ];
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  }, day);
  await page.reload();
  await page.locator("[data-tasks-panel]").waitFor();
  const ids = () => page.locator("[data-tasks-panel] [data-task]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task")));
  assert.deepEqual((await ids()).slice(0, 2), ["g", "g2"], "done main stays on top with its open branch");
  // tomorrow: the main follows its branch there (as the group's head)
  await page.locator(`[data-day="${day + 86400e3}"]:not([aria-hidden="true"])`).first().click();
  await page.waitForTimeout(300);
  assert.deepEqual((await ids()).slice(0, 2), ["g", "g3"], "main shows up on the branch's day");
  await page.locator(`[data-day="${day}"]:not([aria-hidden="true"])`).first().click();
  await page.waitForTimeout(300);
  // finish branch 2: it stays under its main (struck) — the group doesn't split while branch 3 is open
  await page.locator('[data-task="g2"]').getByLabel("Mark done").click();
  let list = await ids();
  assert.deepEqual(list.slice(0, 2), ["g", "g2"], "finished branch stays in its group");
  assert.equal(list.length, 2, "nothing split off into Done");
  // finish branch 3 (on another day) via the store: now everything is done and the main joins Done
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    raw.state.todos.find((t) => t.id === "g3").done = true;
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await page.locator("[data-tasks-panel]").waitFor();
  list = await ids();
  assert.deepEqual([...list].sort(), ["g", "g2"], "main and branch 2 both under Done now");
  console.log("ok - branch groups move together (done main stays while a branch is open)");
}
// a carried-over main with a branch planned today: finishing the branch keeps the two together
{
  const day = midnight();
  await page.evaluate((d) => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    raw.state.todos = [
      { id: "c", name: "Carried main", activityId: "work", color: "#2f7fd8", date: d - 86400e3, missed: [d - 86400e3], done: false, createdAt: 1 },
      { id: "c2", name: "Today's branch", activityId: "work", color: "#2f7fd8", date: d, time: 10 * 60, duration: 30, branchOf: "c", done: false, createdAt: 2 },
    ];
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  }, day);
  await page.reload();
  await page.locator("[data-tasks-panel]").waitFor();
  const ids = () => page.locator("[data-tasks-panel] [data-task]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task")));
  assert.deepEqual(await ids(), ["c", "c2"], "listed once, as a group");
  await page.locator('[data-task="c2"]').getByLabel("Mark done").click();
  await page.waitForTimeout(200);
  assert.deepEqual(await ids(), ["c", "c2"], "still one group after finishing the branch");
  console.log("ok - finishing a branch of a carried main doesn't split the group");
}
console.log("branch e2e passed");
await browser.close();
