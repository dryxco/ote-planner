"use client";

// Keeps this device's store in sync with the server copy (/api/sync).
// Local edits are detected by diffing the store, queued (persisted, so offline edits survive a
// reload), pushed with a short debounce, and remote changes are pulled every few seconds and
// whenever the app comes back to the foreground.

import { create } from "zustand";
import type { Activity, Settings, Timer } from "./types";
import { useSync, type SyncState } from "./store";
import { META_SETTINGS, META_TIMER, keyOf, type SyncChange, type SyncCollection, type SyncResponse } from "./sync-protocol";

const META_KEY = "sync-meta-v1";
const PUSH_DEBOUNCE_MS = 400;
const POLL_MS = 5000;
const FAST_POLL_MS = 1000;
/** How long a new ticket polls fast for its connector link (one that can't be filed doesn't poll forever). */
const FILING_WAIT_MS = 2 * 60_000;

type ArrayCol = "activities" | "plans" | "actuals" | "todos" | "goals" | "diary" | "tickets" | "campaigns";
const ARRAY_COLS: ArrayCol[] = ["activities", "plans", "actuals", "todos", "goals", "diary", "tickets", "campaigns"];

interface Meta {
  since: number;
  /** Local changes not yet acknowledged by the server, by `${col}:${id}`. */
  pending: Record<string, SyncChange>;
  initialized: boolean;
}

export const useSyncStatus = create<{ lastSyncAt: number | null; error: string | null; syncing: boolean }>(() => ({
  lastSyncAt: null,
  error: null,
  syncing: false,
}));

function loadMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? "null") as Meta | null;
    if (m && typeof m.since === "number") return { since: m.since, pending: m.pending ?? {}, initialized: !!m.initialized };
  } catch {}
  return { since: 0, pending: {}, initialized: false };
}
function saveMeta(m: Meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {}
}

/** Store changes between two snapshots, as sync changes stamped `at`. */
export function diffState(prev: SyncState, next: SyncState, at: number): SyncChange[] {
  const out: SyncChange[] = [];
  for (const col of ARRAY_COLS) {
    if (prev[col] === next[col]) continue;
    // collections added later can be missing from an older saved state
    const a = (prev[col] ?? []) as { id: string }[];
    const b = (next[col] ?? []) as { id: string }[];
    const before = new Map(a.map((r) => [r.id, r]));
    const after = new Set<string>();
    for (const r of b) {
      after.add(r.id);
      const old = before.get(r.id);
      if (old === r) continue;
      // an edit sends the fields it changed; a new record goes whole
      out.push(old ? { col, id: r.id, updatedAt: at, data: r, fields: changedFields(old, r) } : { col, id: r.id, updatedAt: at, data: r });
    }
    for (const id of before.keys()) if (!after.has(id)) out.push({ col, id, updatedAt: at, deleted: true });
  }
  if (prev.settings !== next.settings) out.push({ col: "meta", id: META_SETTINGS, updatedAt: at, data: next.settings });
  if (prev.timer !== next.timer) {
    out.push(next.timer ? { col: "meta", id: META_TIMER, updatedAt: at, data: next.timer } : { col: "meta", id: META_TIMER, updatedAt: at, deleted: true });
  }
  return out;
}

/** Keys whose values differ between two versions of a record (added and removed ones too). */
export function changedFields(a: object, b: object): string[] {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].filter((k) => k !== "id" && JSON.stringify(x[k]) !== JSON.stringify(y[k]));
}

/** A queued change followed by another edit of the same record: both edits' fields go. */
export function queueChange(prev: SyncChange | undefined, next: SyncChange): SyncChange {
  if (!prev || prev.deleted || next.deleted || !next.fields) return next;
  // not sent yet as a whole (e.g. just created): it still goes whole
  if (!prev.fields) return { ...next, fields: undefined };
  return { ...next, fields: [...new Set([...prev.fields, ...next.fields])] };
}

/** Every record of the current store, for the first upload of a device. */
function snapshot(s: SyncState, at: number): SyncChange[] {
  const out: SyncChange[] = [];
  for (const col of ARRAY_COLS) for (const r of (s[col] ?? []) as { id: string }[]) out.push({ col, id: r.id, updatedAt: at, data: r });
  out.push({ col: "meta", id: META_SETTINGS, updatedAt: at, data: s.settings });
  if (s.timer) out.push({ col: "meta", id: META_TIMER, updatedAt: at, data: s.timer });
  return out;
}

/** Apply server changes to a store snapshot (pure). */
export function applyChanges(s: SyncState, changes: SyncChange[]): Partial<SyncState> {
  const patch: Partial<SyncState> = {};
  const byCol = new Map<SyncCollection, SyncChange[]>();
  for (const c of changes) byCol.set(c.col, [...(byCol.get(c.col) ?? []), c]);
  for (const col of ARRAY_COLS) {
    const list = byCol.get(col);
    if (!list) continue;
    const map = new Map(((s[col] ?? []) as { id: string }[]).map((r) => [r.id, r]));
    for (const c of list) {
      if (c.deleted) map.delete(c.id);
      else map.set(c.id, c.data as { id: string });
    }
    let arr = [...map.values()];
    if (col === "activities") arr = (arr as Activity[]).sort((x, y) => x.order - y.order);
    (patch as Record<string, unknown>)[col] = arr;
  }
  for (const c of byCol.get("meta") ?? []) {
    if (c.id === META_SETTINGS && !c.deleted) patch.settings = { ...s.settings, ...(c.data as Settings) };
    if (c.id === META_TIMER) patch.timer = c.deleted ? null : (c.data as Timer);
  }
  return patch;
}

let started = false;

/** True while changes from the server are being written into the store (undo ignores those). */
export const remoteApply = { active: false };

/** This window's id (for the server's journal: which device wrote what). */
let myId: string | null = null;
function clientId(): string {
  if (myId) return myId;
  try {
    myId = sessionStorage.getItem("sync-client-id");
    if (!myId) sessionStorage.setItem("sync-client-id", (myId = Math.random().toString(36).slice(2, 10)));
  } catch {
    myId ??= Math.random().toString(36).slice(2, 10);
  }
  return myId;
}

/** Start syncing (idempotent). Returns a stop function. Call after the store has rehydrated. */
export function startSync(): () => void {
  if (started) return () => {};
  started = true;
  const meta = loadMeta();
  let applyingRemote = false;
  let inflight: Promise<void> | null = null;
  let again = false;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;

  if (!meta.initialized) {
    // First sync of this device: upload what it has with an old timestamp, so anything the server
    // already holds (edited on another device) wins, and records only this device has are added.
    for (const c of snapshot(useSync.getState(), 1)) meta.pending[keyOf(c)] = c;
    meta.initialized = true;
    saveMeta(meta);
  }

  const unsub = useSync.subscribe((next, prev) => {
    if (applyingRemote) return;
    const changes = diffState(prev, next, Date.now());
    if (changes.length === 0) return;
    for (const c of changes) meta.pending[keyOf(c)] = queueChange(meta.pending[keyOf(c)], c);
    saveMeta(meta);
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void syncNow(), PUSH_DEBOUNCE_MS);
  });

  async function run() {
    const sent = Object.values(meta.pending);
    useSyncStatus.setState({ syncing: true });
    const r = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-client": clientId() },
      body: JSON.stringify({ since: meta.since, changes: sent }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${r.status}`);
    }
    const res = (await r.json()) as SyncResponse;
    // acknowledged: drop pending entries that weren't edited again meanwhile
    for (const c of sent) {
      const k = keyOf(c);
      if (meta.pending[k]?.updatedAt === c.updatedAt) delete meta.pending[k];
    }
    // don't let the server echo overwrite edits made while the request was in flight
    const incoming = res.changes.filter((c) => {
      const local = meta.pending[keyOf(c)];
      return !local || local.updatedAt < c.updatedAt;
    });
    if (incoming.length) {
      applyingRemote = true;
      remoteApply.active = true;
      try {
        useSync.setState(applyChanges(useSync.getState(), incoming));
      } finally {
        applyingRemote = false;
        remoteApply.active = false;
      }
    }
    meta.since = res.version;
    saveMeta(meta);
    useSyncStatus.setState({ lastSyncAt: Date.now(), error: null, syncing: false });
  }

  function syncNow(): Promise<void> {
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = run()
      .catch((e: Error) => {
        useSyncStatus.setState({
          syncing: false,
          error:
            navigator.onLine === false
              ? "Offline — will sync when you're back online"
              : e instanceof TypeError
                ? "Can't reach the server — retrying automatically"
                : `Ote failed: ${e.message}`,
        });
      })
      .finally(() => {
        inflight = null;
        if (again) {
          again = false;
          void syncNow();
        }
      });
    return inflight;
  }

  // every few seconds; every second while a ticket made here waits for its connector link (the
  // description can't be written before it)
  let lastPoll = 0;
  const poll = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    const filing = (useSync.getState().tickets ?? []).some((t) => !t.rowId && !t.hidden && now - t.createdAt < FILING_WAIT_MS);
    if (!filing && now - lastPoll < POLL_MS) return;
    lastPoll = now;
    void syncNow();
  }, FAST_POLL_MS);
  const onWake = () => {
    if (document.visibilityState === "visible") void syncNow();
  };
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  void syncNow();

  return () => {
    started = false;
    unsub();
    clearInterval(poll);
    if (pushTimer) clearTimeout(pushTimer);
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onWake);
  };
}
