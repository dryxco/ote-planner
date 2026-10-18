import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _resetSyncCache, syncUser, type Applied } from "./syncdb";

const tmp = mkdtempSync(path.join(os.tmpdir(), "syncdb-"));
before(() => {
  process.env.OTE_DATA_DIR = tmp;
});

test("two devices converge; last write wins; deletes propagate", async () => {
  const u = "t1";
  // device A creates a plan
  let a = await syncUser(u, 0, [{ col: "plans", id: "p1", updatedAt: 100, data: { name: "A" } }]);
  assert.equal(a.version, 1);
  // device B (never synced) pulls it
  let b = await syncUser(u, 0, []);
  assert.deepEqual(b.changes.map((c) => c.id), ["p1"]);
  // B edits later, A edits earlier (stale) -> B wins
  b = await syncUser(u, b.version, [{ col: "plans", id: "p1", updatedAt: 200, data: { name: "B" } }]);
  a = await syncUser(u, a.version, [{ col: "plans", id: "p1", updatedAt: 150, data: { name: "A2" } }]);
  assert.equal((a.changes.find((c) => c.id === "p1")!.data as { name: string }).name, "B");
  // A deletes; B sees a tombstone
  a = await syncUser(u, a.version, [{ col: "plans", id: "p1", updatedAt: 300, deleted: true }]);
  b = await syncUser(u, b.version, []);
  assert.equal(b.changes[0].deleted, true);
});

test("persists to disk and survives a restart", async () => {
  await syncUser("t2", 0, [{ col: "meta", id: "settings", updatedAt: 1, data: { dayStart: 300 } }]);
  _resetSyncCache();
  const r = await syncUser("t2", 0, []);
  assert.equal(r.changes.length, 1);
  const file = JSON.parse(await fs.readFile(path.join(tmp, "sync-t2.json"), "utf8"));
  assert.equal(file.version, 1);
});

test("a client ahead of the server gets a full resend", async () => {
  await syncUser("t3", 0, [{ col: "todos", id: "x", updatedAt: 1, data: {} }]);
  const r = await syncUser("t3", 999, []);
  assert.equal(r.changes.length, 1);
});

test("a device's older copy can't erase what only the server fills in (ticket's connector link, plan's event id)", async () => {
  const { keepServerFields } = await import("./syncdb");
  const stored = { id: "t1", title: "New", status: "Not started", rowId: "row-1", databaseId: "db-1", assignees: ["Me"] };
  const incoming = { id: "t1", title: "New", status: "In progress" }; // edited before it heard back
  assert.deepEqual(keepServerFields("tickets", incoming, stored), { id: "t1", title: "New", status: "In progress", rowId: "row-1", databaseId: "db-1", assignees: ["Me"] });
  const plan = keepServerFields("plans", { id: "p", calendar: { calendarId: "mac:local:X" } }, { id: "p", calendar: { calendarId: "mac:local:X", eventId: "ev1" } });
  assert.deepEqual(plan, { id: "p", calendar: { calendarId: "mac:local:X", eventId: "ev1" } });
  // moving the plan to another calendar does drop the old event id
  assert.deepEqual(keepServerFields("plans", { id: "p", calendar: { calendarId: "mac:local:Y" } }, { id: "p", calendar: { calendarId: "mac:local:X", eventId: "ev1" } }), { id: "p", calendar: { calendarId: "mac:local:Y" } });
});

test("an edit of some fields can't put back the rest from an older copy (10/10: checked to-dos came back unchecked)", async () => {
  const u = "t-fields";
  const todo = { id: "c", name: "contact", done: false, order: 1 };
  await syncUser(u, 0, [{ col: "todos", id: "c", updatedAt: 100, data: todo }]);
  // device B checks it off
  await syncUser(u, 1, [{ col: "todos", id: "c", updatedAt: 200, data: { ...todo, done: true, doneAt: 200 }, fields: ["done", "doneAt"] }]);
  // device A, still holding the unchecked copy, moves it (later)
  const r = await syncUser(u, 1, [{ col: "todos", id: "c", updatedAt: 300, data: { ...todo, order: 5 }, fields: ["order"] }]);
  assert.deepEqual(r.changes.find((c) => c.id === "c")!.data, { id: "c", name: "contact", done: true, doneAt: 200, order: 5 });
  // unchecking removes doneAt (a field missing from the record is removed)
  const r2 = await syncUser(u, r.version, [{ col: "todos", id: "c", updatedAt: 400, data: { ...todo, order: 5 }, fields: ["done", "doneAt"] }]);
  assert.deepEqual(r2.changes.find((c) => c.id === "c")!.data, { id: "c", name: "contact", done: false, order: 5 });
});

test("a push is journaled: each record before and after", async () => {
  const applied: Applied = [];
  await syncUser("t-journal", 0, [{ col: "todos", id: "j", updatedAt: 1, data: { id: "j", done: true } }], applied);
  await syncUser("t-journal", 1, [{ col: "todos", id: "j", updatedAt: 2, data: { id: "j", done: false }, fields: ["done"] }], applied);
  assert.equal(applied.length, 2);
  assert.deepEqual([applied[1].before?.data, applied[1].after.data], [{ id: "j", done: true }, { id: "j", done: false }]);
});
