import { test } from "node:test";
import assert from "node:assert/strict";
import { useSync } from "./store";
import { changedFields, queueChange } from "./sync-client";
import { redo, startUndo, undo } from "./undo";
import type { Todo } from "./types";

const td = (id: string, o: Partial<Todo> = {}): Todo => ({ id, name: id, activityId: "work", color: "#000", done: false, createdAt: 0, ...o });

test("changed fields: only what differs, added and removed keys too", () => {
  assert.deepEqual(changedFields({ id: "a", done: false, order: 1 }, { id: "a", done: true, doneAt: 5, order: 1 }).sort(), ["done", "doneAt"]);
  assert.deepEqual(changedFields({ id: "a", doneAt: 5 }, { id: "a" }), ["doneAt"]);
});

test("queued edits of one record send all their fields; one never sent goes whole", () => {
  const a = { col: "todos" as const, id: "x", updatedAt: 1, data: {}, fields: ["done"] };
  const b = { col: "todos" as const, id: "x", updatedAt: 2, data: {}, fields: ["order"] };
  assert.deepEqual(queueChange(a, b).fields?.sort(), ["done", "order"]);
  assert.equal(queueChange({ col: "todos", id: "x", updatedAt: 1, data: {} }, b).fields, undefined);
});

test("undo puts back only its own records, not what another device changed meanwhile", async () => {
  useSync.setState({ todos: [td("mine"), td("theirs")] });
  startUndo();
  useSync.getState().toggleTodo("mine"); // my edit
  await new Promise((r) => setTimeout(r, 350));
  // another device checks "theirs" off (arrives as a remote change: not an undo step)
  const { remoteApply } = await import("./sync-client");
  remoteApply.active = true;
  useSync.setState((s) => ({ todos: s.todos.map((t) => (t.id === "theirs" ? { ...t, done: true } : t)) }));
  remoteApply.active = false;
  assert.equal(undo(), true);
  const by = (id: string) => useSync.getState().todos.find((t) => t.id === id)!;
  assert.equal(by("mine").done, false, "my edit undone");
  assert.equal(by("theirs").done, true, "theirs kept");
  assert.equal(redo(), true);
  assert.equal(by("mine").done, true);
});

test("hiding or skipping a calendar event can be undone and redone", async () => {
  startUndo();
  await new Promise((r) => setTimeout(r, 350));
  useSync.getState().hideEvent("ev-1");
  useSync.getState().skipEvent("ev-2");
  const hidden = () => useSync.getState().settings.hiddenEventIds ?? [];
  assert.ok(hidden().includes("ev-1"));
  assert.equal(undo(), true);
  assert.ok(!hidden().includes("ev-1"));
  assert.ok(!(useSync.getState().settings.skippedEventIds ?? []).includes("ev-2"));
  assert.equal(redo(), true);
  assert.ok(hidden().includes("ev-1"));
});
