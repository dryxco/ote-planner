// Server copy of the user's Sync data (plans, actuals, ...) shared by all devices.
// One JSON file per user under .data/, written atomically; writes are serialized per process.
import { promises as fs } from "node:fs";
import path from "node:path";
import { shared } from "./shared";
import { journal } from "./journal";
import { keyOf, mergeFields, wins, type StoredRecord, type SyncChange, type SyncResponse } from "../sync-protocol";

interface DbFile {
  version: number;
  records: Record<string, StoredRecord>;
}

/** `.data/` next to the app; SYNC_DATA_DIR overrides it (tests). */
function dataDir() {
  return process.env.SYNC_DATA_DIR || path.join(process.cwd(), ".data");
}

function fileFor(userId: string) {
  const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0, 120) || "default";
  return path.join(dataDir(), `sync-${safe}.json`);
}

// one for the process (the jobs' bundle had its own, stale copy: see shared.ts)
const cache = shared("syncdb.cache", () => new Map<string, DbFile>());
const queues = shared("syncdb.queues", () => new Map<string, Promise<unknown>>());

async function load(userId: string): Promise<DbFile> {
  const hit = cache.get(userId);
  if (hit) return hit;
  let db: DbFile;
  try {
    db = JSON.parse(await fs.readFile(fileFor(userId), "utf8")) as DbFile;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Couldn't read the sync data file: ${(e as Error).message}`);
    db = { version: 0, records: {} };
  }
  cache.set(userId, db);
  return db;
}

async function save(userId: string, db: DbFile) {
  await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const file = fileFor(userId);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db), { mode: 0o600 });
  await fs.rename(tmp, file);
}

/** Run fn exclusively for this user (serialized read-modify-write). */
function exclusive<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(userId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(
    userId,
    next.catch(() => {}),
  );
  return next;
}

/**
 * Fields only the server fills in (from a connector / Calendar). A device's copy can predate them — it
 * edited the record before hearing back — and must not erase them by winning last-write-wins: that
 * dropped a new ticket's connector link and got it filed three times (10/9). Kept when the write lacks them.
 */
const SERVER_OWNED: Record<string, string[]> = {
  tickets: ["rowId", "databaseId", "assignees", "author", "files"],
};
export function keepServerFields(col: string, incoming: unknown, stored: unknown): unknown {
  if (!incoming || typeof incoming !== "object" || !stored || typeof stored !== "object") return incoming;
  const inc = incoming as Record<string, unknown>;
  const old = stored as Record<string, unknown>;
  let out = inc;
  for (const f of SERVER_OWNED[col] ?? []) if (inc[f] === undefined && old[f] !== undefined) out = { ...out, [f]: old[f] };
  // a plan's calendar event id (written back by the calendar writer)
  if (col === "plans") {
    const ic = inc.calendar as { calendarId?: string; eventId?: string } | undefined;
    const oc = old.calendar as { calendarId?: string; eventId?: string } | undefined;
    if (ic && oc && ic.calendarId === oc.calendarId && !ic.eventId && oc.eventId) out = { ...out, calendar: { ...ic, eventId: oc.eventId } };
  }
  return out;
}

/** What a device's push changed: each record before and after (for the journal). */
export type Applied = { change: SyncChange; before: StoredRecord | undefined; after: StoredRecord }[];

/** Merge a client's changes (last write wins) and return everything newer than `since`. */
export function syncUser(userId: string, since: number, changes: SyncChange[], applied?: Applied): Promise<SyncResponse> {
  return exclusive(userId, async () => {
    const db = await load(userId);
    let dirty = false;
    for (const c of changes) {
      const k = keyOf(c);
      const stored = db.records[k];
      if (!wins(c, stored)) continue;
      // an edit of some fields: only those, onto the server's copy (a whole record otherwise)
      const data = c.fields && stored && !stored.deleted && stored.data ? mergeFields(stored.data, c.data, c.fields) : c.data;
      db.version += 1;
      db.records[k] = c.deleted
        ? { col: c.col, id: c.id, updatedAt: c.updatedAt, deleted: true, v: db.version }
        : { col: c.col, id: c.id, updatedAt: c.updatedAt, data: keepServerFields(c.col, data, stored?.data), v: db.version };
      applied?.push({ change: c, before: stored, after: db.records[k] });
      dirty = true;
    }
    if (dirty) await save(userId, db);
    // A client ahead of the server (e.g. the data file was reset) gets a full resend.
    const from = since > db.version ? 0 : since;
    const out: SyncChange[] = [];
    for (const r of Object.values(db.records)) {
      if (r.v > from) out.push(r.deleted ? { col: r.col, id: r.id, updatedAt: r.updatedAt, deleted: true } : { col: r.col, id: r.id, updatedAt: r.updatedAt, data: r.data });
    }
    return { version: db.version, changes: out };
  });
}

/** Current (non-deleted and deleted) records of one collection. */
export function readCollection(userId: string, col: string): Promise<StoredRecord[]> {
  return exclusive(userId, async () => Object.values((await load(userId)).records).filter((r) => r.col === col));
}

/**
 * Server-originated changes (e.g. from an integration), merged like a client push. Journaled as "server".
 * Returns the version each written record got (so a sync can tell its own writes from a device's).
 */
export function applyServerChanges(userId: string, changes: SyncChange[]): Promise<Record<string, number>> {
  if (changes.length === 0) return Promise.resolve({});
  return exclusive(userId, async () => {
    const db = await load(userId);
    const applied: Applied = [];
    for (const c of changes) {
      const k = keyOf(c);
      const before = db.records[k];
      if (!wins(c, before)) continue;
      db.version += 1;
      db.records[k] = c.deleted ? { col: c.col, id: c.id, updatedAt: c.updatedAt, deleted: true, v: db.version } : { col: c.col, id: c.id, updatedAt: c.updatedAt, data: c.data, v: db.version };
      applied.push({ change: c, before, after: db.records[k] });
    }
    if (applied.length) {
      await save(userId, db);
      void journal(applied, { client: "server", ua: null });
    }
    return Object.fromEntries(applied.map((a) => [`${a.after.col}:${a.after.id}`, a.after.v]));
  });
}

/** For tests. */
export function _resetSyncCache() {
  cache.clear();
  queues.clear();
}
