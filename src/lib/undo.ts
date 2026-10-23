"use client";

import { useSync } from "./store";
import { remoteApply } from "./sync-client";

/**
 * Undo / redo for your own edits (plans, actuals, to-dos, activities, artifacts, meals, hidden calendar events): ⌘Z / Ctrl+Z, and
 * ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y to redo. Changes arriving from other devices aren't recorded.
 * An undo is an ordinary edit, so it syncs like any other.
 *
 * A step keeps only the records it changed (before → after). Undo puts back just those, and skips one
 * that changed again since (another device checked it off, say): it used to restore a copy of every
 * to-do, which also undid whatever had arrived from other devices meanwhile.
 */
const KEYS = ["plans", "actuals", "todos", "activities", "artifacts", "meals"] as const;
type Col = (typeof KEYS)[number];
type Rec = { id: string };
/** Per collection: record id -> [before, after] (undefined = didn't exist). `events`: per list, event id -> listed [before, after]. */
type Step = Partial<Record<Col, Map<string, [Rec | undefined, Rec | undefined]>>> & { events?: Partial<Record<EventList, Map<string, [boolean, boolean]>>> };

const LIMIT = 100;
/** Edits closer together than this are one step (e.g. stopping a timer records an actual). */
const COALESCE_MS = 300;

const past: Step[] = [];
const future: Step[] = [];
let restoring = false;
let lastAt = 0;
let started = false;

const list = (s: unknown, col: Col) => ((s as Record<Col, Rec[] | undefined>)[col] ?? []) as Rec[];
/** Per-event lists kept in settings: hidden from the timeline, skipped (didn't happen). */
const EVENT_LISTS = ["hiddenEventIds", "skippedEventIds"] as const;
type EventList = (typeof EVENT_LISTS)[number];
const eventIds = (s: unknown, k: EventList) => (s as { settings?: Partial<Record<EventList, string[]>> }).settings?.[k] ?? [];

/** What changed between two states, merged into `into` (keeping each record's first "before"). */
function record(into: Step, prev: unknown, next: unknown) {
  for (const col of KEYS) {
    const a = list(prev, col);
    const b = list(next, col);
    if (a === b) continue;
    const before = new Map(a.map((r) => [r.id, r]));
    const after = new Map(b.map((r) => [r.id, r]));
    const m = (into[col] ??= new Map());
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const x = before.get(id);
      const y = after.get(id);
      if (x === y) continue;
      const had = m.get(id);
      m.set(id, [had ? had[0] : x, y]);
    }
  }
  for (const k of EVENT_LISTS) {
    const la = eventIds(prev, k);
    const lb = eventIds(next, k);
    if (la === lb) continue;
    const a = new Set(la);
    const b = new Set(lb);
    const m = ((into.events ??= {})[k] ??= new Map());
    for (const id of new Set([...a, ...b])) {
      if (a.has(id) === b.has(id)) continue;
      const had = m.get(id);
      m.set(id, [had ? had[0] : a.has(id), b.has(id)]);
    }
  }
}

export function startUndo(): () => void {
  if (started) return () => {};
  started = true;
  const unsub = useSync.subscribe((next, prev) => {
    if (restoring || remoteApply.active) return;
    if (!KEYS.some((k) => next[k] !== prev[k]) && EVENT_LISTS.every((k) => eventIds(next, k) === eventIds(prev, k))) return;
    const now = Date.now();
    if (now - lastAt > COALESCE_MS || past.length === 0) {
      past.push({});
      if (past.length > LIMIT) past.shift();
    }
    record(past[past.length - 1], prev, next);
    lastAt = now;
    future.length = 0;
  });
  return () => {
    unsub();
    started = false;
  };
}

/** Apply one side of a step (0 = before, 1 = after) where the record is still as the other side left it. */
function apply(step: Step, side: 0 | 1) {
  const s = useSync.getState();
  const patch: Partial<Record<Col, Rec[]>> = {};
  for (const col of KEYS) {
    const m = step[col];
    if (!m?.size) continue;
    let arr = [...list(s, col)];
    for (const [id, pair] of m) {
      const want = pair[side];
      const expect = pair[side === 0 ? 1 : 0];
      const i = arr.findIndex((r) => r.id === id);
      if ((i === -1 ? undefined : arr[i]) !== expect) continue; // changed since (e.g. on another device): leave it
      if (want === undefined) arr = arr.filter((r) => r.id !== id);
      else if (i === -1) arr.push(want);
      else arr[i] = want;
    }
    if (col === "activities") arr = (arr as unknown as { order: number }[]).sort((a, b) => a.order - b.order) as unknown as Rec[];
    patch[col] = arr;
  }
  let settings: typeof s.settings | undefined;
  for (const k of EVENT_LISTS) {
    const m = step.events?.[k];
    if (!m?.size) continue;
    const ids = new Set(eventIds(s, k));
    for (const [id, pair] of m) {
      if (ids.has(id) !== pair[side === 0 ? 1 : 0]) continue; // changed since: leave it
      if (pair[side]) ids.add(id);
      else ids.delete(id);
    }
    settings = { ...(settings ?? s.settings), [k]: [...ids] };
  }
  restoring = true;
  try {
    useSync.setState({ ...(patch as Partial<ReturnType<typeof useSync.getState>>), ...(settings && { settings }) });
  } finally {
    restoring = false;
  }
  lastAt = 0;
}

export function undo(): boolean {
  const step = past.pop();
  if (!step) return false;
  apply(step, 0);
  future.push(step);
  return true;
}

export function redo(): boolean {
  const step = future.pop();
  if (!step) return false;
  apply(step, 1);
  past.push(step);
  return true;
}
