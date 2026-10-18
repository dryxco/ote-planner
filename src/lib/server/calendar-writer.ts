// Plans saved "to a calendar" become real events on this Mac's Calendar (iCloud, Google, … —
// whatever Apple Calendar syncs), through the EventKit helper. Runs on the server after plan
// changes arrive: creates the event, keeps title / time / place in step, deletes it with the plan
// (or when the plan is set back to "Sync only"). Only events Sync created are ever touched.
// The other way: an event Sync wrote that's been deleted in Calendar deletes its plan here too.
// Repeating plans aren't written (one-off plans only).
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Plan } from "../types";
import type { SyncChange } from "../sync-protocol";
import { applyServerChanges, readCollection } from "./syncdb";
import { shared } from "./shared";
import { runHelper } from "./mac-calendar";
import { invalidate } from "./cache";
import { getStore } from "./store";

const OWNER = "default";
const PREFIX = "mac:local:";

interface Link {
  eventId: string;
  calendarId: string; // native EventKit calendar id
  hash: string;
}
interface State {
  links: Record<string, Link>; // planId -> event
  lastError?: string | null;
}

const file = () => path.join(process.env.SYNC_DATA_DIR || path.join(process.cwd(), ".data"), "calendar-writes.json");
async function load(): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(file(), "utf8")) as State;
  } catch {
    return { links: {} };
  }
}
async function save(s: State) {
  await fs.mkdir(path.dirname(file()), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
  await fs.rename(tmp, file());
}

/** EventKit ids of the events Sync created (their ghosts are hidden). */
export async function writtenEventIds(): Promise<Set<string>> {
  return new Set(Object.values((await load()).links).map((l) => l.eventId));
}

/**
 * The iCalendar UIDs of the events Sync wrote. An EventKit event id is `<local part>:<UID>`, and the UID
 * is what an ICS feed / iCloud of that same calendar carries — so the same event reaching Sync that way
 * can be told apart from the plan that's already on the timeline.
 */
export async function writtenEventUids(): Promise<Set<string>> {
  return new Set(Object.values((await load()).links).map((l) => l.eventId.slice(l.eventId.lastIndexOf(":") + 1)).filter(Boolean));
}

const DAY = 86_400_000;
/** How far around a linked plan we look for its event (so one moved in Calendar isn't taken as deleted). */
const LOOK_AROUND = 366 * DAY;
const WINDOW = 1000 * DAY;

export interface CalEventLite {
  calendarId: string;
  title: string;
  start: number;
  end: number;
  ekId?: string;
}

/**
 * Which written events are gone from Calendar. An event whose id changed (EventKit can re-issue ids
 * after a calendar sync) but is still there — same calendar, title and times — is re-linked, not
 * taken as deleted.
 */
export function findDeletedInCalendar(
  linked: { planId: string; link: { eventId: string; calendarId: string }; plan: Plan }[],
  events: CalEventLite[],
): { deleted: string[]; relinked: Record<string, string> } {
  const ids = new Set(events.map((e) => e.ekId).filter(Boolean));
  const deleted: string[] = [];
  const relinked: Record<string, string> = {};
  for (const { planId, link, plan } of linked) {
    if (ids.has(link.eventId)) continue;
    const same = events.find((e) => e.calendarId === link.calendarId && e.title === (plan.name || "") && e.start === plan.start && e.end === plan.end && e.ekId);
    if (same) relinked[planId] = same.ekId!;
    else deleted.push(planId);
  }
  return { deleted, relinked };
}

const nativeCal = (id: string) => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null);
const body = (p: Plan) => ({ title: p.name || "", start: p.start, end: p.end, allDay: p.allDay, location: p.place ?? "" });
const hashOf = (p: Plan, cal: string) => JSON.stringify([cal, body(p)]);
const writable = (p: Plan) => p.repeat === "never" && p.end > p.start;

const lock = shared("calendar-writer.lock", () => ({ running: null as Promise<void> | null, again: false }));

/** Reconcile plans -> calendar events (single-flight; a request during a run triggers one more). */
export function syncPlansToCalendars(): Promise<void> {
  if (lock.running) {
    lock.again = true;
    return lock.running;
  }
  lock.running = (async () => {
    do {
      lock.again = false;
      await run();
    } while (lock.again);
  })().finally(() => {
    lock.running = null;
  });
  return lock.running;
}

async function run() {
  const store = await getStore();
  if (!store.mac) return; // this Mac's calendars aren't connected
  const state = await load();
  const recs = await readCollection(OWNER, "plans");
  const plans = new Map<string, Plan>();
  for (const r of recs) if (!r.deleted) plans.set(r.id, r.data as Plan);
  const back: SyncChange[] = [];
  let touched = false;
  try {
    // deleted in Calendar -> delete the plan in Sync too. Only plans unchanged since their event was
    // written count (a changed one is handled below), and only when the listing worked.
    const unchanged = Object.entries(state.links).filter(([id, l]) => {
      const p = plans.get(id);
      const cal = p?.calendar && nativeCal(p.calendar.calendarId);
      return p && cal && writable(p) && l.hash === hashOf(p, cal);
    });
    if (unchanged.length) {
      const from = Math.min(...unchanged.map(([id]) => plans.get(id)!.start)) - LOOK_AROUND;
      const to = Math.max(...unchanged.map(([id]) => plans.get(id)!.end)) + LOOK_AROUND;
      const events: CalEventLite[] = [];
      let ok = true;
      // EventKit searches at most ~4 years at a time
      for (let a = from; a < to && ok; a += WINDOW) {
        const res = (await runHelper(["events", String(a), String(Math.min(to, a + WINDOW))])) as { events?: CalEventLite[] };
        if (Array.isArray(res?.events)) events.push(...res.events);
        else ok = false;
      }
      if (ok) {
        const { deleted, relinked } = findDeletedInCalendar(unchanged.map(([id, l]) => ({ planId: id, link: l, plan: plans.get(id)! })), events);
        for (const [id, ekId] of Object.entries(relinked)) state.links[id] = { ...state.links[id], eventId: ekId };
        for (const id of deleted) {
          back.push({ col: "plans", id, updatedAt: Date.now(), deleted: true });
          plans.delete(id);
          delete state.links[id];
          touched = true;
          console.info(`[sync] Calendar: event of plan ${id.slice(0, 8)} was deleted in Calendar — plan removed`);
        }
      }
    }
    // plans that should have an event
    for (const p of plans.values()) {
      const cal = p.calendar && nativeCal(p.calendar.calendarId);
      if (!cal || !writable(p)) continue;
      const link = state.links[p.id];
      const h = hashOf(p, cal);
      if (link && link.hash === h) continue;
      if (!link) {
        const r = (await runHelper(["create", JSON.stringify({ calendarId: cal, ...body(p) })])) as { eventId: string };
        state.links[p.id] = { eventId: r.eventId, calendarId: cal, hash: h };
        // remember the event on the plan (all devices see it's on a calendar)
        back.push({ col: "plans", id: p.id, updatedAt: Date.now(), data: { ...p, calendar: { calendarId: p.calendar!.calendarId, eventId: r.eventId } } });
      } else {
        const r = (await runHelper(["update", JSON.stringify({ eventId: link.eventId, calendarId: cal, ...body(p) })])) as { eventId?: string; gone?: boolean };
        if (r.gone) {
          // deleted in Calendar: make a new one (the plan still says it belongs on a calendar)
          const c = (await runHelper(["create", JSON.stringify({ calendarId: cal, ...body(p) })])) as { eventId: string };
          state.links[p.id] = { eventId: c.eventId, calendarId: cal, hash: h };
          back.push({ col: "plans", id: p.id, updatedAt: Date.now(), data: { ...p, calendar: { calendarId: p.calendar!.calendarId, eventId: c.eventId } } });
        } else {
          state.links[p.id] = { eventId: r.eventId || link.eventId, calendarId: cal, hash: h };
        }
      }
      touched = true;
      await save(state);
    }
    // events whose plan is gone, became repeating, or went back to "Sync only"
    for (const [planId, link] of Object.entries(state.links)) {
      const p = plans.get(planId);
      if (p && p.calendar && nativeCal(p.calendar.calendarId) && writable(p)) continue;
      await runHelper(["delete", JSON.stringify({ eventId: link.eventId })]);
      delete state.links[planId];
      touched = true;
      await save(state);
    }
    state.lastError = null;
  } catch (e) {
    state.lastError = (e as Error).message;
    console.warn(`[sync] calendar write failed: ${state.lastError}`);
  } finally {
    await save(state);
    if (back.length) await applyServerChanges(OWNER, back);
    if (touched) invalidate("mac:events:");
  }
}

const g = globalThis as unknown as { __calWriteSoon?: ReturnType<typeof setTimeout> };
/** Every couple of minutes: notices events deleted in Calendar (plan changes run sooner). */
export function startCalendarWriteJob() {
  const gg = globalThis as unknown as { __calWriteTimer?: ReturnType<typeof setInterval> };
  if (gg.__calWriteTimer) return;
  gg.__calWriteTimer = setInterval(() => void syncPlansToCalendars(), 120_000);
}

/** Debounced run after plan changes arrive. */
export function scheduleCalendarWrites(delayMs = 1500) {
  if (g.__calWriteSoon) clearTimeout(g.__calWriteSoon);
  g.__calWriteSoon = setTimeout(() => void syncPlansToCalendars(), delayMs);
}
