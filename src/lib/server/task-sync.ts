// Two-way sync between Ote and a connector's task board (connectors/types.ts → TaskSource).
//
//   - a task with a start AND end time  <->  a Ote Plan (one-off, same-day, not all-day)
//   - any other task                    <->  a Ote To-do
// When a task gains or loses its times on one side, it moves between Plan and To-do on the other.
// Ids are shared (a task made in Ote is created there with Ote's id). Sources needn't have change
// timestamps: each run is a 3-way merge against the snapshot taken at the last good run; when both
// sides changed, the edit made in Ote wins. Deleting in Ote removes it there (`remove`); archived /
// deleted there removes it here. Repeating, all-day and overnight plans stay Ote-only.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Actual, Plan, Todo } from "../types";
import type { SyncChange } from "../sync-protocol";
import { applyServerChanges, readCollection } from "./syncdb";
import { shared } from "./shared";
import type { RemoteTask, TaskSource } from "./connectors/types";
import { dateStringToMidnight, wallTimeToMs } from "./time";

const DEFAULT_MAX_WRITES = 40;
const IMPORT_DONE_WITHIN_DAYS = 30;
const DAY = 86_400_000;

/** Fields a To-do shares with a task. */
export interface Norm {
  title: string;
  done: boolean;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
  due: string | null; // YYYY-MM-DD
}
/** Fields a Plan shares with a timed task. */
export interface PlanNorm {
  title: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
}
/** `done` on a plan = whether Ote had it done (a confirmed actual) when its status was last pushed. */
/** `rolled`: `n` is a date the board rolled the plan to (not taken into Ote; ignored while the board keeps it). */
type Base = { kind: "todo"; n: Norm } | { kind: "plan"; n: PlanNorm; done?: boolean; rolled?: boolean };

interface State {
  /** Project of each linked task at the last run (for the activity <-> project merge). */
  projBase?: Record<string, string | null>;
  base: Record<string, Base>;
  lastRunAt?: number;
  lastOkAt?: number;
  /** Server version of the sync data read by the last good run: newer records were saved since. */
  seenV?: number;
  /** Versions this sync wrote itself (`col:id` -> v): not edits made in Ote. */
  ownV?: Record<string, number>;
  lastError?: string | null;
  lastResult?: Summary;
}

export interface Summary {
  pushedNew: number;
  pushedUpdates: number;
  archived: number;
  pulledNew: number;
  pulledUpdates: number;
  deletedLocal: number;
  skipped: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Date / time helpers in the source's zone. */
export function zoned(tz: string) {
  const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opts }).format(new Date(ms));
  return {
    ymd: (ms: number) => fmt(ms, { year: "numeric", month: "2-digit", day: "2-digit" }),
    hm: (ms: number) => fmt(ms, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    wall: (date: string, time: string) => {
      const [y, m, d] = date.split("-").map(Number);
      const [hh, mm] = time.split(":").map(Number);
      return wallTimeToMs(y, m, d, hh, mm, 0, tz);
    },
    midnight: (date: string) => dateStringToMidnight(date, tz),
  };
}

// ---- To-dos ----

export function normSync(t: Todo, tz: string): Norm {
  const z = zoned(tz);
  return {
    title: t.name.trim(),
    done: !!t.done,
    date: t.date !== undefined ? z.ymd(t.date) : null,
    time: t.date !== undefined && t.time !== undefined ? `${pad(Math.floor(t.time / 60))}:${pad(t.time % 60)}` : null,
    due: t.deadline !== undefined ? z.ymd(t.deadline) : null,
  };
}

export function normRemote(d: RemoteTask): Norm {
  return {
    title: d.title.trim(),
    done: d.done,
    date: d.date ?? null,
    time: d.date && d.time ? d.time.slice(0, 5) : null,
    due: d.due ?? null,
  };
}

export const sameNorm = (a: Norm, b: Norm) =>
  a.title === b.title && a.done === b.done && a.date === b.date && a.time === b.time && a.due === b.due;

/** Ote to-do updated with the source's values (Ote-only fields like activity/plan are kept). */
export function applyNormToTodo(base: Todo | null, n: Norm, id: string, now: number, tz: string): Todo {
  const z = zoned(tz);
  const t: Todo = base ? { ...base } : { id, name: n.title, activityId: "other", color: "#5f5f64", done: false, createdAt: now };
  t.name = n.title;
  if (n.done && !t.done) t.doneAt = now;
  if (!n.done) delete t.doneAt;
  t.done = n.done;
  if (n.date) t.date = z.midnight(n.date);
  else delete t.date;
  if (n.date && n.time) {
    const [h, m] = n.time.split(":").map(Number);
    t.time = h * 60 + m;
  } else {
    delete t.time;
    delete t.duration; // Ote-only; meaningless without a time
  }
  if (n.due) t.deadline = z.midnight(n.due);
  else delete t.deadline;
  return t;
}

// ---- Plans ----

/** A task with both times shows as a Plan. */
export const isTimed = (d: RemoteTask) => !!(d.date && d.time && d.endTime);

/** Plans that can live on the board: one-off, timed, within one day. */
export function planNorm(p: Plan, tz: string): PlanNorm | null {
  if (p.repeat !== "never" || p.allDay || p.end <= p.start) return null;
  const z = zoned(tz);
  const date = z.ymd(p.start);
  if (z.ymd(p.end - 1) !== date) return null; // overnight: a task has one date
  return { title: p.name.trim(), date, start: z.hm(p.start), end: p.end - z.midnight(date) >= DAY ? "23:59" : z.hm(p.end) };
}

export function planNormRemote(d: RemoteTask): PlanNorm {
  return { title: d.title.trim(), date: d.date!, start: d.time!.slice(0, 5), end: d.endTime!.slice(0, 5) };
}

/**
 * A board that rolls open past tasks over to today also catches a past plan Ote never confirmed. A
 * plan is a time that's gone, not unfinished work: that move isn't taken back into Ote.
 */
// The move can be to any day up to today: the day it rolled them on is "yesterday" once midnight
// passes (checking for *today* only let what was skipped all day in at 00:00).
export const isBoardRollover = (sync: PlanNorm, remote: PlanNorm, today: string) =>
  sync.date < today && remote.date <= today && remote.date > sync.date && remote.title === sync.title && remote.start === sync.start && remote.end === sync.end;

export const samePlan = (a: PlanNorm, b: PlanNorm) => a.title === b.title && a.date === b.date && a.start === b.start && a.end === b.end;

/** Past plans moved by the source in one run that hold the whole batch back (see the run). */
export const BULK_PAST_MOVES = 3;

/**
 * What one run does with a plan that's on both sides and differs:
 * - "push": Ote changed it since the last run (Ote wins)
 * - "skip": a board that rolls over (`rollsOver`) moved it in a way Ote never takes in — a past plan
 *   moved forward to a day up to today with the same times (by title, or by times alone once the plan
 *   is over: a plan named only by its activity gets that name on the board), or a rolled value already
 *   skipped that the board still keeps. A plan is a time that's gone, not unfinished work.
 * - "pull": take the source's value
 */
export function decidePlan(
  sync: PlanNorm,
  remote: PlanNorm,
  base: { n: PlanNorm; rolled?: boolean } | null,
  syncEdited: boolean,
  today: string,
  over: boolean,
  rollsOver: boolean,
): "push" | "skip" | "pull" {
  if (!base || (!samePlan(sync, base.n) && syncEdited)) return "push";
  if (!rollsOver) return "pull";
  if (base.rolled && samePlan(remote, base.n)) return "skip";
  if (isBoardRollover(sync, remote, today)) return "skip";
  if (over && sync.date < remote.date && remote.date <= today && remote.start === sync.start && remote.end === sync.end) return "skip";
  return "pull";
}

export function applyPlanNorm(base: Plan | null, n: PlanNorm, id: string, now: number, tz: string): Plan {
  const z = zoned(tz);
  const start = z.wall(n.date, n.start);
  let end = z.wall(n.date, n.end);
  if (end <= start) end = start + 30 * 60_000;
  const p: Plan = base
    ? { ...base }
    : { id, name: n.title, activityId: "other", color: "#5f5f64", allDay: false, start, end, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: now };
  return { ...p, name: n.title, start, end, repeat: "never", allDay: false };
}

// ---- activity <-> source project mapping (.data/task-projects.json, optional) ----

export interface ProjectMapping {
  /** Ote activity name (matched case-insensitively). */
  activity: string;
  project_id: string;
  /** The source's project name, for reference. */
  project?: string;
}

const dataDir = () => process.env.OTE_DATA_DIR || path.join(process.cwd(), ".data");

async function loadProjectMap(): Promise<ProjectMapping[]> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dataDir(), "task-projects.json"), "utf8"));
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m.activity === "string" && typeof m.project_id === "string") : [];
  } catch {
    return [];
  }
}

// ---- state ----

const stateFile = () => path.join(dataDir(), "task-sync.json");
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

export async function taskSyncStatus() {
  const s = await loadState();
  return { lastRunAt: s.lastRunAt ?? null, lastOkAt: s.lastOkAt ?? null, lastError: s.lastError ?? null, lastResult: s.lastResult ?? null, linked: Object.keys(s.base).length };
}

/** Forget the link snapshot (on disconnect) so a later reconnect starts from a clean merge. */
export async function resetTaskSync() {
  await saveState({ base: {} });
}

const lock = shared("task-sync.lock", () => ({ running: null as Promise<Summary> | null }));

/** Run one reconciliation (single-flight across the process). */
export function syncTasks(owner: string, src: TaskSource): Promise<Summary> {
  if (lock.running) return lock.running;
  lock.running = run(owner, src).finally(() => {
    lock.running = null;
  });
  return lock.running;
}

async function run(owner: string, src: TaskSource): Promise<Summary> {
  const tz = src.timeZone;
  const z = zoned(tz);
  const state = await loadState();
  const now = Date.now();
  state.lastRunAt = now;
  const sum: Summary = { pushedNew: 0, pushedUpdates: 0, archived: 0, pulledNew: 0, pulledUpdates: 0, deletedLocal: 0, skipped: 0 };
  try {
    const listed = await src.list();
    const D = new Map<string, RemoteTask>();
    for (const t of listed.tasks) D.set(t.id, t);
    const archivedIds = new Set(listed.archivedIds);
    const listsMayBeTruncated = !listed.complete;

    // Ote: to-dos and the plans that can live on the board
    const [todoRecs, planRecs] = await Promise.all([readCollection(owner, "todos"), readCollection(owner, "plans")]);
    const ST = new Map<string, Todo>();
    const SP = new Map<string, Plan>();
    const deletedInSync = new Set<string>();
    // saved in Ote since the last good run (by the server's version, not a device's clock): only
    // then does Ote's value go to the board. A stale read of the sync data used to push old values
    // as if they were Ote's edits.
    const seenV = state.seenV;
    const readV = Math.max(0, ...[...todoRecs, ...planRecs].map((r) => r.v));
    const editedSince = new Set(
      [...todoRecs, ...planRecs]
        .filter((r) => !r.deleted && state.ownV?.[`${r.col}:${r.id}`] !== r.v && (seenV === undefined ? r.updatedAt > (state.lastOkAt ?? 0) : r.v > seenV))
        .map((r) => r.id),
    );
    const syncEdited = (id: string) => seenV === undefined || editedSince.has(id);
    for (const r of todoRecs) {
      if (r.deleted) deletedInSync.add(r.id);
      // tasks made automatically from unplanned actuals stay in Ote (they'd flood the board), and so
      // do to-dos that carry a ticket on the timeline (the ticket itself is mirrored already)
      else if (!(r.data as Todo).fromActual && !(r.data as Todo).ticketId) ST.set(r.id, r.data as Todo);
    }
    // a plan named only by its activity ("Meal") goes to the board under that name (tasks need a title)
    const actNames = new Map(
      (await readCollection(owner, "activities")).filter((r) => !r.deleted).map((r) => [r.id, (r.data as { name: string }).name]),
    );
    for (const r of planRecs) {
      if (r.deleted) deletedInSync.add(r.id);
      else {
        const p = r.data as Plan;
        SP.set(r.id, p.name?.trim() ? p : { ...p, name: actNames.get(p.activityId) ?? "Untitled" });
      }
    }

    // a plan is done in Ote once an actual fulfils it fully (no tentative rest left)
    const donePlans = new Set<string>();
    for (const r of await readCollection(owner, "actuals")) {
      const a = r.data as Actual;
      if (!r.deleted && a.planKey && !a.rest) donePlans.add(a.planKey.split("@")[0]);
    }
    const prevPlanDone = new Map<string, boolean>();
    for (const [id, b] of Object.entries(state.base)) if (b.kind === "plan" && b.done) prevPlanDone.set(id, true);

    const local: SyncChange[] = [];
    let writes = 0;
    const canWrite = () => writes < (src.maxWritesPerRun ?? DEFAULT_MAX_WRITES);
    const todoFields = (n: Norm) => ({ title: n.title, done: n.done, date: n.date, time: n.date ? n.time : null, endTime: null, due: n.due });
    const planFields = (n: PlanNorm) => ({ title: n.title, date: n.date, time: n.start, endTime: n.end, due: null });
    const setTodo = (id: string, t: Todo) => local.push({ col: "todos", id, updatedAt: now, data: t });
    const setPlan = (id: string, p: Plan) => local.push({ col: "plans", id, updatedAt: now, data: p });
    const del = (col: "todos" | "plans", id: string) => local.push({ col, id, updatedAt: now, deleted: true });

    const ids = new Set<string>([...ST.keys(), ...SP.keys(), ...D.keys(), ...Object.keys(state.base)]);
    const failures: string[] = [];
    // The source moving the dates of several plans that are already over, in one run, is never the
    // user rescheduling: whatever the pattern, those moves wait (and Settings says why).
    const pastMoves: { id: string; apply: () => void }[] = [];
    for (const id of ids) {
      // one bad item must not stop the rest of the board from syncing
      try {
        const st = ST.get(id);
        const sp = SP.get(id);
        const spn = sp ? planNorm(sp, tz) : null;
        if (sp && !spn && !st) {
          // a Ote-only plan (repeating / all-day / overnight): never on the board
          if (state.base[id] && D.has(id) && canWrite()) {
            // it used to be on the board (e.g. became repeating): take it off there
            await src.remove(id);
            writes++;
            sum.archived++;
          }
          delete state.base[id];
          continue;
        }
        const d = D.get(id);
        const b = state.base[id];
        const sKind: "todo" | "plan" | null = spn ? "plan" : st ? "todo" : null;

        if (sKind && d) {
          const dKind = isTimed(d) ? "plan" : "todo";
          if (sKind !== dKind) {
            // Moved between To-do and Plan on one side. If Ote still matches the snapshot's kind,
            // the source moved it; otherwise Ote did (and Ote wins).
            const remoteMoved = !!b && b.kind === sKind;
            if (remoteMoved) {
              if (dKind === "plan") {
                del("todos", id);
                setPlan(id, applyPlanNorm(null, planNormRemote(d), id, now, tz));
                state.base[id] = { kind: "plan", n: planNormRemote(d) };
              } else {
                del("plans", id);
                setTodo(id, applyNormToTodo(null, normRemote(d), id, now, tz));
                state.base[id] = { kind: "todo", n: normRemote(d) };
              }
              sum.pulledUpdates++;
            } else if (canWrite()) {
              if (sKind === "plan") await src.update(id, planFields(spn!));
              else await src.update(id, todoFields(normSync(st!, tz)));
              writes++;
              state.base[id] = sKind === "plan" ? { kind: "plan", n: spn! } : { kind: "todo", n: normSync(st!, tz) };
              sum.pushedUpdates++;
            }
            continue;
          }
          if (sKind === "plan") {
            const dn = planNormRemote(d);
            if (samePlan(spn!, dn)) {
              state.base[id] = { kind: "plan", n: dn, ...(b?.kind === "plan" && b.done ? { done: true } : {}) };
              continue;
            }
            const pb = b?.kind === "plan" ? b : null;
            const decision = decidePlan(spn!, dn, pb, syncEdited(id), z.ymd(now), sp!.end <= now, !!src.rollsOver);
            if (decision === "skip") {
              // keep the plan on its day; remember the board's value so it isn't pushed back (and rolled again)
              state.base[id] = { kind: "plan", n: dn, rolled: true, ...(pb?.done ? { done: true } : {}) };
              sum.skipped++;
            } else if (decision === "pull") {
              const apply = () => {
                setPlan(id, applyPlanNorm(sp!, dn, id, now, tz));
                state.base[id] = { kind: "plan", n: dn };
                sum.pulledUpdates++;
              };
              if (sp!.end <= now && dn.date !== spn!.date) pastMoves.push({ id, apply });
              else apply();
            } else if (canWrite()) {
              await src.update(id, planFields(spn!));
              writes++;
              state.base[id] = { kind: "plan", n: spn! };
              sum.pushedUpdates++;
            }
          } else {
            const sn = normSync(st!, tz);
            const dn = normRemote(d);
            if (sameNorm(sn, dn)) {
              state.base[id] = { kind: "todo", n: sn };
              continue;
            }
            const bn = b?.kind === "todo" ? b.n : null;
            const sChanged = !bn || (!sameNorm(sn, bn) && syncEdited(id));
            if (!sChanged) {
              setTodo(id, applyNormToTodo(st!, dn, id, now, tz));
              state.base[id] = { kind: "todo", n: dn };
              sum.pulledUpdates++;
            } else if (canWrite()) {
              await src.update(id, todoFields(sn));
              writes++;
              state.base[id] = { kind: "todo", n: sn };
              sum.pushedUpdates++;
            }
          }
        } else if (sKind && !d) {
          if (archivedIds.has(id) && (!b || editedSince.has(id)) && canWrite()) {
            // archived there, but Ote made or changed it since: bring it back there instead of
            // deleting it here (a create with an archived id could leave it archived and loop)
            await src.update(id, { ...(sKind === "plan" ? planFields(spn!) : todoFields(normSync(st!, tz))), archived: false });
            writes++;
            state.base[id] = sKind === "plan" ? { kind: "plan", n: spn! } : { kind: "todo", n: normSync(st!, tz) };
            sum.pushedUpdates++;
            console.info(`[sync] tasks: re-opened archived ${sKind} ${id.slice(0, 8)} (changed in Ote)`);
          } else if (b) {
            if (listsMayBeTruncated) continue; // can't tell "gone" from "not listed"
            del(sKind === "plan" ? "plans" : "todos", id); // archived / deleted there
            delete state.base[id];
            sum.deletedLocal++;
            console.info(`[sync] tasks: ${id.slice(0, 8)} is gone from the board (${archivedIds.has(id) ? "archived" : "not listed"}) — removed in Ote`);
          } else if (src.acceptsId && !src.acceptsId(id)) {
            sum.skipped++; // ids the source can't take
          } else if (canWrite()) {
            if (sKind === "plan") {
              await src.create({ id, ...planFields(spn!), done: false });
              state.base[id] = { kind: "plan", n: spn! };
            } else {
              const sn = normSync(st!, tz);
              await src.create({ id, ...todoFields(sn) });
              state.base[id] = { kind: "todo", n: sn };
            }
            writes++;
            sum.pushedNew++;
          }
        } else if (!sKind && d) {
          if (deletedInSync.has(id) || b) {
            if (!canWrite()) continue;
            await src.remove(id);
            writes++;
            console.info(`[sync] tasks: removed ${id.slice(0, 8)} there (${deletedInSync.has(id) ? "deleted in Ote" : "no longer in Ote"})`);
            delete state.base[id];
            sum.archived++;
          } else if (isTimed(d)) {
            const dn = planNormRemote(d);
            if (z.midnight(dn.date) < now - IMPORT_DONE_WITHIN_DAYS * DAY && d.done) continue;
            setPlan(id, applyPlanNorm(null, dn, id, now, tz));
            state.base[id] = { kind: "plan", n: dn };
            sum.pulledNew++;
          } else {
            const dn = normRemote(d);
            const old = dn.done && (!dn.date || z.midnight(dn.date) < now - IMPORT_DONE_WITHIN_DAYS * DAY);
            if (old) continue; // don't import long-finished history
            setTodo(id, applyNormToTodo(null, dn, id, now, tz));
            state.base[id] = { kind: "todo", n: dn };
            sum.pulledNew++;
          }
        } else {
          delete state.base[id];
        }
      } catch (e) {
        failures.push(`${id.slice(0, 8)}: ${(e as Error).message}`);
      }
    }
    if (pastMoves.length >= BULK_PAST_MOVES) {
      failures.push(`the source moved ${pastMoves.length} past plans to other days at once — not taken in (${pastMoves.slice(0, 3).map((m) => m.id.slice(0, 8)).join(", ")}…)`);
      console.warn(`[sync] tasks: held back ${pastMoves.length} moves of past plans (looks like a board rollover)`);
    } else for (const m of pastMoves) m.apply();
    // Plan done-ness, Ote -> source only: a plan is "done" in Ote when an actual confirms it. Push
    // the status when that changes (confirmed / actual removed); a check made there is left as is.
    for (const [id, b] of Object.entries(state.base)) {
      if (b.kind !== "plan") continue;
      const d = D.get(id);
      const sDone = donePlans.has(id);
      const was = prevPlanDone.get(id) ?? false;
      b.done = was;
      if (!d || !SP.has(id) || sDone === was) continue;
      try {
        if (sDone !== d.done) {
          if (!canWrite()) continue;
          await src.update(id, { done: sDone });
          writes++;
          sum.pushedUpdates++;
        }
        b.done = sDone;
      } catch (e) {
        failures.push(`${id.slice(0, 8)}: ${(e as Error).message}`);
      }
    }
    // Activity <-> the source's project (.data/task-projects.json), same 3-way merge
    const map = await loadProjectMap();
    if (map.length) {
      const acts = (await readCollection(owner, "activities")).filter((r) => !r.deleted).map((r) => r.data as { id: string; name: string; color: string });
      const actByName = new Map(acts.map((a) => [a.name.trim().toLowerCase(), a]));
      const projOfAct = new Map<string, string>(); // activity id -> project id
      const actOfProj = new Map<string, { id: string; color: string }>();
      for (const m of map) {
        const a = actByName.get(m.activity.trim().toLowerCase());
        if (!a) continue;
        projOfAct.set(a.id, m.project_id);
        actOfProj.set(m.project_id, a);
      }
      const latest = new Map<string, SyncChange>();
      for (const c of local) latest.set(`${c.col}:${c.id}`, c);
      state.projBase ??= {};
      for (const id of Object.keys(state.base)) {
        const d = D.get(id);
        if (!d) continue;
        const col = latest.has(`plans:${id}`) || (!latest.has(`todos:${id}`) && SP.has(id)) ? "plans" : "todos";
        const ch = latest.get(`${col}:${id}`);
        if (ch?.deleted) continue;
        const rec = (ch?.data ?? (col === "plans" ? SP.get(id) : ST.get(id))) as (Todo | Plan) | undefined;
        if (!rec) continue;
        const sProj = projOfAct.get(rec.activityId) ?? null;
        const dProj = d.projectId ?? null;
        const base = id in state.projBase ? state.projBase[id] : undefined;
        if (sProj === dProj) {
          state.projBase[id] = dProj;
          continue;
        }
        const sChanged = base === undefined ? !!sProj : sProj !== base;
        const dChanged = base === undefined ? !!dProj : dProj !== base;
        if (dChanged && (!sChanged || base === undefined)) {
          // filed under another project there: follow with the mapped activity (unmapped -> keep)
          const a = dProj ? actOfProj.get(dProj) : undefined;
          if (a) {
            local.push({ col, id, updatedAt: now, data: { ...rec, activityId: a.id, color: a.color } });
            sum.pulledUpdates++;
          }
          state.projBase[id] = dProj;
        } else if (sChanged && canWrite()) {
          // activity changed in Ote: file it under the mapped project (or none)
          if (sProj || (dProj && actOfProj.has(dProj))) {
            await src.update(id, { projectId: sProj });
            writes++;
            sum.pushedUpdates++;
            state.projBase[id] = sProj;
          } else {
            state.projBase[id] = dProj; // an unmapped project there is left alone
          }
        }
      }
    }

    // what this run wrote isn't an edit made in Ote next time (a task pulled in, then archived there,
    // was taken as "changed in Ote" and put back on the board)
    state.ownV = await applyServerChanges(owner, local);
    state.lastOkAt = Date.now();
    state.seenV = readV;
    state.lastError = failures.length ? `${failures.length} item(s) failed — ${failures.slice(0, 3).join("; ")}` : null;
    if (failures.length) console.warn(`[sync] task sync: ${state.lastError}`);
    state.lastResult = sum;
    return sum;
  } catch (e) {
    state.lastError = (e as Error).message;
    throw e;
  } finally {
    await saveState(state);
  }
}
