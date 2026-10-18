import { test } from "node:test";
import assert from "node:assert/strict";
import { openAndDone, stillCarried } from "./store";
import type { Todo } from "./types";

const day = new Date(2026, 9, 9).getTime();
const td = (id: string, o: Partial<Todo> = {}): Todo => ({ id, name: id, activityId: "work", color: "#000", done: false, createdAt: 0, ...o });

test("a finished branch stays with its open main instead of splitting off into Done", () => {
  // main carried from 10/8, branch planned today and just finished
  const all = [td("main", { date: day - 86400000, missed: [day - 86400000] }), td("branch", { branchOf: "main", date: day, done: true, doneAt: day })];
  const { open, done } = openAndDone(all, (t) => t.date === day, day);
  assert.deepEqual(open.map((t) => t.id).sort(), ["branch", "main"]);
  assert.deepEqual(done, []);
});

test("the whole group goes to Done once all of it is done", () => {
  const all = [td("main", { date: day, done: true }), td("branch", { branchOf: "main", date: day, done: true })];
  const { open, done } = openAndDone(all, (t) => t.date === day, day);
  assert.deepEqual(open, []);
  assert.deepEqual(done.map((t) => t.id).sort(), ["branch", "main"]);
});

test("a done main stays on top while a branch is open (as before)", () => {
  const all = [td("main", { date: day, done: true }), td("branch", { branchOf: "main", date: day })];
  assert.deepEqual(openAndDone(all, (t) => t.date === day, day).open.map((t) => t.id).sort(), ["branch", "main"]);
});

test("a branch finished on a day already past goes to Done, even with its group still open", () => {
  const DAY = 86400000;
  const all = [
    td("main", { date: day }),
    td("old", { branchOf: "main", date: day - DAY, done: true, doneAt: day - DAY }),
    td("now", { branchOf: "main", date: day, done: true, doneAt: day }),
    td("late", { branchOf: "main", date: day + DAY, done: true, doneAt: day - DAY }),
  ];
  const { open, done } = openAndDone(all, () => true, day);
  assert.deepEqual(open.map((t) => t.id).sort(), ["late", "main", "now"]);
  assert.deepEqual(done.map((t) => t.id), ["old"]);
});

test("dragged into No date it stops being carried over, until it's missed again", () => {
  const DAY = 86400000;
  assert.equal(stillCarried(td("t", { missed: [day - DAY] })), true);
  assert.equal(stillCarried(td("t", { missed: [day - DAY], settled: day - DAY })), false);
  assert.equal(stillCarried(td("t", { missed: [day - DAY, day + DAY], settled: day - DAY })), true);
  assert.equal(stillCarried(td("t")), false);
});

test("a branch stays in its main's project, with its note; old ones lacking them get them back", async () => {
  const { useSync } = await import("./store");
  const s = useSync.getState();
  const main = s.addTodo({ name: "Qwen test", activityId: "work", color: "#000", campaignId: "c1", note: "n" });
  const b = useSync.getState().branchTodo(main)!;
  let t = useSync.getState().todos.find((x) => x.id === b)!;
  assert.equal(t.campaignId, "c1");
  assert.equal(t.note, "n");
  // a branch made before the fix
  useSync.setState({ todos: useSync.getState().todos.map((x) => (x.id === b ? { ...x, campaignId: undefined, note: undefined } : x)) });
  useSync.getState().repairBranchShared();
  t = useSync.getState().todos.find((x) => x.id === b)!;
  assert.equal(t.campaignId, "c1");
  assert.equal(t.note, "n");
});

test("in a project folder a dated branch still sits under its undated main", async () => {
  const { withBranchesUnderMain } = await import("./store");
  const all = [td("main", { campaignId: "c" }), td("b2", { branchOf: "main", date: day, campaignId: "c" })];
  const { open } = openAndDone(all, () => true, day);
  const sorted = open.sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity)); // by day, as the folder does
  assert.deepEqual(withBranchesUnderMain(sorted).map((t) => t.id), ["main", "b2"]);
});

test("branches can be put in any order under their main, which stays first", async () => {
  const { useSync, withBranchesUnderMain, branchLabel } = await import("./store");
  const s = useSync.getState();
  const main = s.addTodo({ name: "order main", activityId: "work", color: "#000", date: day });
  s.branchTodo(main);
  s.branchTodo(main); // same key as the first (both main + 0.5): a move must still stick
  const list = () => withBranchesUnderMain(useSync.getState().todos.filter((t) => t.id === main || t.branchOf === main)).map((t) => t.id);
  s.branchTodo(list()[1]);
  const [, b1, b2, b3] = list();
  assert.equal(list()[0], main);
  s.moveBranch(b3, 0);
  assert.deepEqual(list(), [main, b3, b1, b2]);
  s.moveBranch(b1, 2);
  assert.deepEqual(list(), [main, b3, b2, b1]);
  s.moveBranch(b2, 0);
  assert.deepEqual(list(), [main, b2, b3, b1]);
  const todos = useSync.getState().todos;
  assert.equal(branchLabel(todos.find((t) => t.id === b2)!, todos), "(2/4)");
  assert.equal(branchLabel(todos.find((t) => t.id === b1)!, todos), "(4/4)");
});

test("a no-date to-do done takes the day it was done on; unchecked, it's undated again", async () => {
  const { useSync } = await import("./store");
  const { logicalDate } = await import("./time");
  const s = useSync.getState();
  const today = logicalDate(Date.now(), useSync.getState().settings.dayStart);
  const id = s.addTodo({ name: "undated", activityId: "work", color: "#000" });
  const get = () => useSync.getState().todos.find((t) => t.id === id)!;
  s.toggleTodo(id);
  assert.equal(get().date, today);
  assert.equal(get().done, true);
  s.toggleTodo(id);
  assert.equal(get().date, undefined);
  assert.equal(get().done, false);
  // a date given by hand after that stays when it's unchecked
  s.toggleTodo(id);
  s.updateTodo(id, { date: today + 86_400_000 });
  s.toggleTodo(id);
  assert.equal(get().date, today + 86_400_000);
  // a dated one keeps its day
  const dated = s.addTodo({ name: "dated", activityId: "work", color: "#000", date: today - 86_400_000 });
  s.toggleTodo(dated);
  assert.equal(useSync.getState().todos.find((t) => t.id === dated)!.date, today - 86_400_000);
});
