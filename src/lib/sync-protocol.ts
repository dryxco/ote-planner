// Device sync protocol shared by the client and /api/sync.
//
// Every record lives in a collection and is merged per record, last write wins (updatedAt).
// Deletions are tombstones so they reach other devices. The server keeps a monotonically
// increasing version; a client pulls everything changed after the version it last saw.

export const SYNC_COLLECTIONS = ["activities", "plans", "actuals", "todos", "goals", "diary", "tickets", "campaigns", "meta"] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

/** Singletons stored in the "meta" collection. */
export const META_SETTINGS = "settings";
export const META_TIMER = "timer";

export interface SyncChange {
  col: SyncCollection;
  id: string;
  /** Client wall-clock ms of the edit; the later one wins. */
  updatedAt: number;
  deleted?: boolean;
  data?: unknown;
  /**
   * The fields this edit changed (an edit of a record the device already had). The server applies
   * only these onto its copy, so a device holding an older copy can't put back the rest — e.g. a
   * to-do checked on another device going unchecked (10/10). Missing = the whole record.
   */
  fields?: string[];
}

export interface SyncRequest {
  /** Server version this client has already applied (0 = never synced). */
  since: number;
  changes: SyncChange[];
}

export interface SyncResponse {
  version: number;
  /** Records changed on the server after `since` (includes merged results of this push). */
  changes: SyncChange[];
}

export interface StoredRecord extends SyncChange {
  /** Server version at which this record last changed. */
  v: number;
}

/** Last write wins; on a tie the stored record stays. */
export function wins(incoming: SyncChange, stored: SyncChange | undefined): boolean {
  return !stored || incoming.updatedAt > stored.updatedAt;
}

export const keyOf = (c: { col: string; id: string }) => `${c.col}:${c.id}`;

export function isSyncChange(x: unknown): x is SyncChange {
  const c = x as SyncChange;
  return (
    !!c &&
    typeof c === "object" &&
    (SYNC_COLLECTIONS as readonly string[]).includes(c.col) &&
    typeof c.id === "string" &&
    c.id.length > 0 &&
    c.id.length <= 200 &&
    typeof c.updatedAt === "number" &&
    Number.isFinite(c.updatedAt) &&
    (c.fields === undefined || (Array.isArray(c.fields) && c.fields.length <= 100 && c.fields.every((f) => typeof f === "string" && f.length > 0 && f.length <= 64))) &&
    (c.deleted === true || c.data !== undefined)
  );
}

/** `stored` with only `fields` taken from `incoming` (a field missing from `incoming` was removed). */
export function mergeFields(stored: unknown, incoming: unknown, fields: string[]): unknown {
  if (!stored || typeof stored !== "object" || !incoming || typeof incoming !== "object") return incoming;
  const out: Record<string, unknown> = { ...(stored as Record<string, unknown>) };
  const inc = incoming as Record<string, unknown>;
  for (const f of fields) {
    if (f === "id") continue;
    if (f in inc && inc[f] !== undefined) out[f] = inc[f];
    else delete out[f];
  }
  return out;
}
