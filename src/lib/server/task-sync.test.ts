import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RemoteTask, TaskSource } from "./connectors/types";
import { applyNormToTodo, applyPlanNorm, isBoardRollover, isTimed, normRemote, normSync, planNorm, planNormRemote, sameNorm, samePlan } from "./task-sync";

const TZ = "Asia/Seoul"; // npm test runs with TZ=Asia/Seoul, so local dates below match
before(() => {
  process.env.OTE_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "task-sync-"));
});

const task = (o: Partial<RemoteTask> = {}): RemoteTask => ({ id: "x", title: "Report", done: false, date: null, time: null, endTime: null, due: null, ...o });

test("normalizes both sides to the same shape", () => {
  const sync = normSync({ id: "x", name: " Report ", activityId: "work", color: "#000", date: new Date(2026, 9, 8).getTime(), time: 570, deadline: new Date(2026, 9, 10).getTime(), done: false, createdAt: 0 }, TZ);
  const remote = normRemote(task({ date: "2026-10-08", time: "09:30:00", due: "2026-10-10" }));
  assert.deepEqual(sync, remote);
  assert.ok(sameNorm(sync, remote));
});

test("applying the source's values keeps Ote-only fields (activity, plan)", () => {
  const t = applyNormToTodo(
    { id: "x", name: "a", activityId: "work", color: "#2f7fd8", planId: "p1", done: false, createdAt: 1 },
    { title: "b", done: true, date: null, time: null, due: "2026-10-10" },
    "x",
    100,
    TZ,
  );
  assert.equal(t.name, "b");
  assert.equal(t.done, true);
  assert.equal(t.doneAt, 100);
  assert.equal(t.activityId, "work");
  assert.equal(t.planId, "p1");
  assert.equal(t.date, undefined);
  assert.equal(t.deadline, new Date(2026, 9, 10).getTime());
});

test("timed tasks <-> Plans", () => {
  const t = task({ title: "Design review", date: "2026-10-08", time: "14:00:00", endTime: "15:30:00" });
  assert.ok(isTimed(t));
  assert.ok(!isTimed({ ...t, endTime: null }));
  const n = planNormRemote(t);
  assert.deepEqual(n, { title: "Design review", date: "2026-10-08", start: "14:00", end: "15:30" });
  const p = applyPlanNorm(null, n, "x", 0, TZ);
  assert.equal(p.start, new Date(2026, 9, 8, 14, 0).getTime());
  assert.equal(p.end, new Date(2026, 9, 8, 15, 30).getTime());
  assert.ok(samePlan(planNorm(p, TZ)!, n), "round trip");
  // Ote-only plans
  assert.equal(planNorm({ ...p, repeat: "daily" }, TZ), null);
  assert.equal(planNorm({ ...p, allDay: true }, TZ), null);
  assert.equal(planNorm({ ...p, end: new Date(2026, 9, 9, 1, 0).getTime() }, TZ), null, "overnight");
  // a plan ending exactly at midnight stays on its day
  assert.equal(planNorm({ ...p, start: new Date(2026, 9, 8, 23, 0).getTime(), end: new Date(2026, 9, 9, 0, 0).getTime() }, TZ)!.end, "23:59");
});

test("a board's rollover of a past plan to today isn't taken as a move", () => {
  const p = { title: "Workshop", date: "2026-10-14", start: "13:30", end: "16:00" };
  assert.equal(isBoardRollover(p, { ...p, date: "2026-10-17" }, "2026-10-17"), true);
  // moved on purpose: other times, a future day, or the plan wasn't in the past
  assert.equal(isBoardRollover(p, { ...p, date: "2026-10-17", start: "14:00" }, "2026-10-17"), false);
  assert.equal(isBoardRollover({ ...p, date: "2026-10-17" }, { ...p, date: "2026-10-18" }, "2026-10-17"), false);
  assert.equal(isBoardRollover(p, { ...p, date: "2026-10-13" }, "2026-10-17"), false);
});

/** A task board in memory: what a connector would talk to. */
function memoryBoard() {
  const tasks = new Map<string, RemoteTask>();
  const archived = new Set<string>();
  const src: TaskSource = {
    timeZone: TZ,
    async list() {
      return { tasks: [...tasks.values()], archivedIds: [...archived], complete: true };
    },
    async create(t) {
      tasks.set(t.id, { ...t });
    },
    async update(id, patch) {
      const { archived: arch, ...rest } = patch;
      const t = tasks.get(id) ?? (archived.has(id) ? ({ id } as RemoteTask) : null);
      if (!t) throw new Error(`no task ${id}`);
      if (arch === false) archived.delete(id);
      tasks.set(id, { ...t, ...rest });
    },
    async remove(id) {
      tasks.delete(id);
      archived.add(id);
    },
  };
  return { tasks, archived, src };
}

test("end to end: a to-do and a plan go out, edits come back, deletes go both ways", async () => {
  const { syncTasks } = await import("./task-sync");
  const { applyServerChanges, readCollection } = await import("./syncdb");
  const owner = "e2e";
  const board = memoryBoard();
  const day = new Date(2026, 9, 20).getTime();
  await applyServerChanges(owner, [
    { col: "todos", id: "t1", updatedAt: 1, data: { id: "t1", name: "Buy milk", activityId: "other", color: "#000", done: false, createdAt: 1 } },
    { col: "plans", id: "p1", updatedAt: 1, data: { id: "p1", name: "Gym", activityId: "other", color: "#000", allDay: false, start: day + 7 * 3600e3, end: day + 8 * 3600e3, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: 1 } },
  ]);

  let sum = await syncTasks(owner, board.src);
  assert.equal(sum.pushedNew, 2);
  assert.deepEqual(board.tasks.get("t1"), { id: "t1", title: "Buy milk", done: false, date: null, time: null, endTime: null, due: null });
  assert.deepEqual(board.tasks.get("p1"), { id: "p1", title: "Gym", done: false, date: "2026-10-20", time: "07:00", endTime: "08:00", due: null });

  // done on the board, and the plan moved an hour later there
  board.tasks.set("t1", { ...board.tasks.get("t1")!, done: true });
  board.tasks.set("p1", { ...board.tasks.get("p1")!, time: "08:00", endTime: "09:00" });
  sum = await syncTasks(owner, board.src);
  assert.equal(sum.pulledUpdates, 2);
  const todo = (await readCollection(owner, "todos")).find((r) => r.id === "t1")!.data as { done: boolean };
  assert.equal(todo.done, true);
  const plan = (await readCollection(owner, "plans")).find((r) => r.id === "p1")!.data as { start: number };
  assert.equal(plan.start, day + 8 * 3600e3);

  // a task added on the board comes in; deleted in Ote goes away there
  board.tasks.set("t2", { id: "t2", title: "Call Sam", done: false, date: "2026-10-21", time: null, endTime: null, due: null });
  await applyServerChanges(owner, [{ col: "todos", id: "t1", updatedAt: Date.now(), deleted: true }]);
  sum = await syncTasks(owner, board.src);
  assert.equal(sum.pulledNew, 1);
  assert.equal(sum.archived, 1);
  assert.ok(!board.tasks.has("t1"));
  assert.ok((await readCollection(owner, "todos")).some((r) => r.id === "t2" && !r.deleted));

  // archived on the board: removed in Ote
  await board.src.remove("t2");
  sum = await syncTasks(owner, board.src);
  assert.equal(sum.deletedLocal, 1);
  assert.ok((await readCollection(owner, "todos")).find((r) => r.id === "t2")!.deleted);
});
