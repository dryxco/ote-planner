// Two-way sync of a connector's tickets assigned to the signed-in person (connectors/types.ts →
// TicketSource).
//
// Pull: tickets the source lists as mine become Ote tickets (record id = the source's id).
// Push: tickets made in Ote on a source project are filed there. Title / status / priority /
// estimate / due are a 3-way merge per field against the snapshot of the last good run; when both
// sides changed a field, Ote wins (like the task sync).
// Delete: removing a ticket in Ote only hides it here. A ticket no longer assigned to me leaves Ote.
// Tickets in a project of your own (`local:` ids, Settings.localProjects) never leave Ote.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Ticket } from "../types";
import type { SyncChange } from "../sync-protocol";
import { applyServerChanges, readCollection } from "./syncdb";
import { shared } from "./shared";
import { StaleError, type RemoteTicket, type TicketNorm, type TicketSource } from "./connectors/types";

export type { TicketNorm };
const DEFAULT_MAX_WRITES = 20;
/** Finished tickets stay in Ote this long after completion (a project holds hundreds of old ones). */
const KEEP_DONE_MS = 14 * 86_400_000;
/** On the timer only every other minute (edits run at once). */
const IDLE_EVERY_MS = 110_000;

export const sameTicket = (a: TicketNorm, b: TicketNorm) =>
  a.title === b.title && a.status === b.status && a.priority === b.priority && a.estimate === b.estimate && a.due === b.due;

/**
 * Per field: Ote's value where Ote changed it since the last run, else the source's. (Whole-ticket
 * "Ote wins" put a stale status back: a title edited here undid a move made there.)
 */
export function mergeTicket(sync: TicketNorm, remote: TicketNorm, base: TicketNorm): TicketNorm {
  const out = { ...remote };
  for (const k of Object.keys(out) as (keyof TicketNorm)[]) if (sync[k] !== base[k]) (out as Record<string, unknown>)[k] = sync[k];
  return out;
}

export const normTicket = (t: Ticket): TicketNorm => ({
  title: t.title.trim(),
  status: t.status,
  priority: t.priority ?? null,
  estimate: t.estimate ?? null,
  due: t.due ?? null,
});

export const normRemoteTicket = (r: RemoteTicket): TicketNorm => ({
  title: r.title.trim(),
  status: r.status,
  priority: r.priority ?? null,
  estimate: r.estimate ?? null,
  due: r.due ?? null,
});

/** Ote's view of a remote ticket: the shared fields plus what only the source edits. */
export function remoteToTicket(base: Ticket | null, id: string, r: RemoteTicket, projectName: string): Ticket {
  const n = normRemoteTicket(r);
  return {
    ...(base ?? {}),
    id,
    rowId: r.id,
    databaseId: r.containerId,
    projectId: r.projectId,
    projectName,
    ...n,
    statusGroup: r.statusGroup,
    statusColor: r.statusColor ?? null,
    assignees: r.assignees ?? [],
    author: r.author ?? null,
    createdAt: r.createdAt ?? base?.createdAt ?? Date.now(),
    completedAt: r.completedAt ?? null,
    // keep ours while the status stays, else when it last changed there
    statusSince: base && base.status === n.status && base.statusSince ? base.statusSince : (r.updatedAt ?? null),
    files: r.files ?? [],
    hidden: base?.hidden,
    order: base?.order,
  };
}

/** A ticket made in Ote that should be filed on the source: not removed, not in a project of my own. */
export const goesToSource = (t: Ticket) => !t.hidden && !t.local && !t.projectId.startsWith("local:");

// ---- state ----

interface State {
  /** Snapshot of each linked ticket at the last good run (keyed by the source's id). */
  base: Record<string, TicketNorm>;
  /**
   * Tickets this sync created, by the Ote ticket id they were made for. The link on the record itself
   * (rowId) can be lost: a device that edits the ticket before it hears back still has the copy
   * without it, and its later write wins — so the record looked unfiled again and was created again.
   * This map keeps the link on the server.
   */
  made?: Record<string, string>;
  lastRunAt?: number;
  lastOkAt?: number;
  /** Server version of the sync data read by the last good run: newer records were saved since. */
  seenV?: number;
  /** Tickets whose Ote edit was refused as stale: still Ote's edit on the next run. */
  retry?: string[];
  lastError?: string | null;
  lastResult?: TicketSummary;
}
export interface TicketSummary {
  pulled: number;
  pushed: number;
  created: number;
  removed: number;
}
const stateFile = () => path.join(process.env.OTE_DATA_DIR || path.join(process.cwd(), ".data"), "ticket-sync.json");
async function loadState(): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(stateFile(), "utf8")) as State;
  } catch {
    return { base: {} };
  }
}
async function saveState(s: State) {
  await fs.mkdir(path.dirname(stateFile()), { recursive: true, mode: 0o700 });
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
  await fs.rename(tmp, stateFile());
}
export async function ticketSyncStatus() {
  const s = await loadState();
  return { lastRunAt: s.lastRunAt ?? null, lastOkAt: s.lastOkAt ?? null, lastError: s.lastError ?? null, lastResult: s.lastResult ?? null, linked: Object.keys(s.base).length };
}
export async function resetTicketSync() {
  await saveState({ base: {} });
}

// ---- the run ----

const lock = shared("ticket-sync.lock", () => ({ running: null as Promise<TicketSummary> | null, again: null as Promise<TicketSummary> | null, lastStart: 0 }));
export function syncTickets(owner: string, src: TicketSource, opts: { idle?: boolean; everyMs?: number } = {}): Promise<TicketSummary> {
  if (lock.running) {
    if (opts.idle) return lock.running;
    // an edit while a run is going: run once more right after it (that run read the tickets before
    // the edit — waiting for the timer instead left a new ticket unfiled for up to two minutes)
    lock.again ??= lock.running.then(() => {
      lock.again = null;
      return syncTickets(owner, src);
    });
    return lock.again;
  }
  if (opts.idle && Date.now() - lock.lastStart < (opts.everyMs ?? IDLE_EVERY_MS)) return Promise.resolve({ pulled: 0, pushed: 0, created: 0, removed: 0 });
  lock.lastStart = Date.now();
  lock.running = run(owner, src).finally(() => {
    lock.running = null;
  });
  return lock.running;
}

async function run(owner: string, src: TicketSource): Promise<TicketSummary> {
  const state = await loadState();
  const now = Date.now();
  state.lastRunAt = now;
  const sum: TicketSummary = { pulled: 0, pushed: 0, created: 0, removed: 0 };
  try {
    const meta = await src.meta();
    const projName = new Map(meta.projects.map((p) => [p.id, p.name]));
    const canHold = new Set(meta.projects.filter((p) => !p.noBoard).map((p) => p.id));
    const firstStatus = meta.options.status.find((s) => s.group === "to_do")?.name ?? meta.options.status[0]?.name ?? "";

    // Ote
    const recs = await readCollection(owner, "tickets");
    // Ote's values go out only for records saved since the last good run (by the server's
    // version): a stale read of the sync data once pushed old statuses back
    const readV = Math.max(0, ...recs.map((r) => r.v));
    const savedSince = new Set([...recs.filter((r) => state.seenV === undefined || r.v > state.seenV!).map((r) => r.id), ...(state.retry ?? [])]);
    const retry: string[] = [];
    const S = new Map<string, Ticket>(); // by the source's id
    const unlinked: Ticket[] = [];
    state.made ??= {};
    // remember the links of tickets filed before `made` existed (their record id isn't the source's)
    for (const r of recs) {
      const t = r.data as Ticket | undefined;
      if (!r.deleted && t?.rowId && t.id !== t.rowId) state.made[t.id] ??= t.rowId;
    }
    for (const r of recs) {
      if (r.deleted) continue;
      const t = r.data as Ticket;
      const rowId = t.rowId ?? state.made[t.id];
      if (rowId) S.set(rowId, { ...t, rowId }); // a lost link comes back from `made`
      else unlinked.push(t);
    }

    const local: SyncChange[] = [];
    const put = (t: Ticket) => local.push({ col: "tickets", id: t.id, updatedAt: now, data: t });
    let writes = 0;
    const canWrite = () => writes < (src.maxWritesPerRun ?? DEFAULT_MAX_WRITES);

    // made in Ote -> filed on the source, assigned to me
    for (const t of unlinked) {
      if (!goesToSource(t) || !canHold.has(t.projectId) || !canWrite()) continue;
      const n = normTicket(t);
      const r = await src.create(t.projectId, { ...n, status: n.status || firstStatus });
      writes++;
      state.made[t.id] = r.id;
      await saveState(state); // before anything else can fail: never create it twice
      put(remoteToTicket(t, t.id, r, projName.get(t.projectId) ?? t.projectName ?? ""));
      state.base[r.id] = normRemoteTicket(r);
      sum.created++;
    }

    // filed before the list is read: the ticket gets its link (and the sheet its description) at once
    if (local.length) await applyServerChanges(owner, local.splice(0));

    const listed = await src.listMine();
    const D = new Map<string, RemoteTicket>();
    for (const r of listed.tickets) {
      if (r.completedAt && r.completedAt < now - KEEP_DONE_MS) continue; // long finished
      D.set(r.id, r);
    }

    for (const [rowId, d] of D) {
      const st = S.get(rowId);
      const dn = normRemoteTicket(d);
      const pName = projName.get(d.projectId) ?? "";
      if (!st) {
        if (Object.values(state.made).includes(rowId)) continue; // ours, its record is being re-linked
        put(remoteToTicket(null, rowId, d, pName));
        state.base[rowId] = dn;
        sum.pulled++;
        continue;
      }
      const sn = normTicket(st);
      const bn = state.base[rowId];
      const want = bn ? (savedSince.has(st.id) ? mergeTicket(sn, dn, bn) : dn) : sn;
      if (sameTicket(want, dn)) {
        // take the source's values (and refresh what only it edits: people, files, dates)
        const next = remoteToTicket(st, st.id, d, pName);
        const stored = recs.find((r) => r.id === st.id)?.data as Ticket | undefined;
        if (stored?.rowId !== rowId || JSON.stringify({ ...next, updatedAt: 0 }) !== JSON.stringify({ ...st, updatedAt: 0 })) {
          put(next);
          if (!sameTicket(sn, dn)) sum.pulled++;
        }
        state.base[rowId] = dn;
      } else if (canWrite()) {
        try {
          const r = await src.update(d, want);
          writes++;
          put(remoteToTicket(st, st.id, r, pName));
          state.base[rowId] = normRemoteTicket(r);
          sum.pushed++;
        } catch (e) {
          if (!(e instanceof StaleError)) throw e;
          retry.push(st.id); // edited there meanwhile: again next run, still as Ote's edit
        }
      }
    }

    // linked here but no longer assigned to me (or gone): leaves Ote
    if (listed.complete)
      for (const [rowId, st] of S) {
        if (D.has(rowId)) continue;
        local.push({ col: "tickets", id: st.id, updatedAt: now, deleted: true });
        delete state.base[rowId];
        if (state.made[st.id] === rowId) delete state.made[st.id];
        sum.removed++;
      }

    if (local.length) await applyServerChanges(owner, local);
    state.lastOkAt = now;
    state.seenV = readV;
    state.retry = retry;
    state.lastError = null;
    state.lastResult = sum;
    if (sum.pulled + sum.pushed + sum.created + sum.removed) console.info(`[sync] tickets: ${JSON.stringify(sum)}`);
  } catch (e) {
    state.lastError = (e as Error).message;
    console.warn(`[sync] ticket sync failed: ${state.lastError}`);
  }
  await saveState(state);
  return sum;
}
