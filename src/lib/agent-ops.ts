"use client";

import type { CalendarInfo, Plan, Repeat } from "./types";
import { loadWritableCalendars } from "./writable-calendars";
import { OTHER_ID, activityOf, useSync } from "./store";
import { useUI } from "./ui";
import { expandPlans } from "./plans";
import { DAY, MIN, addDays, logicalDayRange, startOfDay } from "./time";

/**
 * The chat agent never touches data itself: it answers with a list of operations, which the app
 * validates and applies here through the normal store actions (so they sync and ⌘Z undoes them).
 * Times are local wall-clock "YYYY-MM-DDTHH:mm"; dates "YYYY-MM-DD"; activities by id or name.
 */
export type AgentOp =
  | { op: "add_plan"; name: string; activity?: string; start: string; end: string; all_day?: boolean; repeat?: Repeat; color?: string; calendar?: string | null }
  | { op: "update_plan"; id: string; name?: string; activity?: string; start?: string; end?: string; repeat?: Repeat; color?: string; calendar?: string | null }
  | { op: "delete_plan"; id: string }
  | { op: "add_actual"; name: string; activity?: string; start: string; end: string; plan_id?: string; plan_occurrence_start?: string; color?: string }
  | { op: "update_actual"; id: string; name?: string; activity?: string; start?: string; end?: string; color?: string }
  | { op: "delete_actual"; id: string }
  | { op: "add_todo"; name: string; activity?: string; date?: string | null; time?: string | null; end_time?: string | null; deadline?: string | null }
  | { op: "update_todo"; id: string; name?: string; activity?: string; date?: string | null; time?: string | null; end_time?: string | null; deadline?: string | null; done?: boolean }
  | { op: "delete_todo"; id: string }
  | { op: "add_activity"; name: string; color: string }
  | { op: "update_activity"; id: string; name?: string; color?: string }
  | { op: "delete_activity"; id: string }
  | { op: "go_to_date"; date: string };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const local = (t: number) => {
  const d = new Date(t);
  return `${ymd(t)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

function parseLocal(s: unknown): number {
  const m = typeof s === "string" && /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(s.trim());
  if (!m) throw new Error(`bad time "${String(s)}"`);
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)).getTime();
}
const parseDate = (s: unknown) => startOfDay(parseLocal(s));
function parseHM(s: unknown): number {
  const m = typeof s === "string" && /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`bad time of day "${String(s)}"`);
  return +m[1] * 60 + +m[2];
}
const HEX = /^#[0-9a-f]{6}$/i;

/** Calendars a plan can be saved to (shown in Settings and writable), for the agent's context. */
let calendars: CalendarInfo[] = [];
export async function loadAgentCalendars() {
  const hidden = new Set(useSync.getState().settings.hiddenCalendarIds);
  calendars = (await loadWritableCalendars()).filter((c) => !hidden.has(c.id));
}
function findCalendar(ref: string | null | undefined): string | null | undefined {
  if (ref === undefined) return undefined;
  if (!ref) return null; // "Sync only"
  const r = ref.trim().toLowerCase();
  const c =
    calendars.find((x) => x.id === ref) ??
    calendars.find((x) => `${x.name} · ${x.accountId}`.toLowerCase() === r) ??
    calendars.find((x) => x.name.toLowerCase() === r);
  if (!c) throw new Error(`no calendar "${ref}"`);
  return c.id;
}

/** What the agent sees: the current state around the viewed day, compact, with ids. */
export function agentContext() {
  const s = useSync.getState();
  const date = useUI.getState().date;
  const now = Date.now();
  // what the agent sees: a month back to a year ahead (a plan it just added for next month must be in
  // its list next turn), plus anything made in the last day wherever it falls
  const from = addDays(date, -30);
  const to = addDays(date, 366);
  const recent = now - DAY;
  const [dayStart, dayEnd] = logicalDayRange(date, s.settings.dayStart);
  const act = (id: string) => activityOf(s.activities, id).name;
  return {
    now: local(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewed_date: ymd(date),
    viewed_day_range: [local(dayStart), local(dayEnd)],
    day_starts_at: hm(s.settings.dayStart),
    activities: [...s.activities].sort((a, b) => a.order - b.order).map((a) => ({ id: a.id, name: a.name, color: a.color })),
    calendars_plans_can_be_saved_to: calendars.map((c) => ({ id: c.id, name: c.name, account: c.accountId })),
    plans: s.plans
      .filter((p) => p.repeat !== "never" || (p.end > from && p.start < to) || p.createdAt > recent)
      .map((p) => ({ id: p.id, name: p.name, activity: act(p.activityId), start: local(p.start), end: local(p.end), all_day: p.allDay || undefined, repeat: p.repeat === "never" ? undefined : p.repeat, calendar: p.calendar?.calendarId })),
    plan_occurrences_on_viewed_day: expandPlans(s.plans, dayStart, dayEnd).map((o) => ({ plan_id: o.plan.id, name: o.plan.name, start: local(o.start), end: local(o.end) })),
    actuals: s.actuals
      .filter((a) => a.end > from && a.start < to)
      .map((a) => ({ id: a.id, name: a.name, activity: act(a.activityId), start: local(a.start), end: local(a.end), plan: a.planKey })),
    todos: s.todos
      .filter((t) => !t.done || (t.doneAt ?? 0) > now - 14 * DAY)
      .map((t) => ({
        id: t.id,
        name: t.name,
        activity: act(t.activityId),
        done: t.done || undefined,
        date: t.date !== undefined ? ymd(t.date) : undefined,
        time: t.time !== undefined ? hm(t.time) : undefined,
        end_time: t.time !== undefined && t.duration ? hm((t.time + t.duration) % 1440) : undefined,
        deadline: t.deadline !== undefined ? ymd(t.deadline) : undefined,
      })),
    timer: s.timer ? { name: s.timer.name, activity: act(s.timer.activityId), since: local(s.timer.start) } : null,
  };
}

/** Apply the agent's operations. Returns one line per op (✓ done / ✗ skipped with the reason). */
export function applyAgentOps(ops: AgentOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    try {
      out.push(`✓ ${applyOne(op)}`);
    } catch (e) {
      out.push(`✗ ${(op as { op?: string }).op ?? "?"}: ${(e as Error).message}`);
    }
  }
  return out;
}

function applyOne(op: AgentOp): string {
  const s = useSync.getState();
  const findActivity = (ref: string | undefined) => {
    if (!ref) return undefined;
    const r = ref.trim().toLowerCase();
    const a = s.activities.find((x) => x.id === ref) ?? s.activities.find((x) => x.name.toLowerCase() === r);
    if (!a) throw new Error(`no activity "${ref}"`);
    return a;
  };
  const range = (start: string, end: string) => {
    const a = parseLocal(start);
    const b = parseLocal(end);
    if (!(b > a)) throw new Error("end must be after start");
    if (b - a > 7 * DAY) throw new Error("longer than a week");
    return [a, b] as const;
  };
  const colorOf = (c: string | undefined, fallback: string) => (c && HEX.test(c) ? c : fallback);
  const need = <T,>(x: T | undefined, what: string): T => {
    if (!x) throw new Error(`no ${what}`);
    return x;
  };

  switch (op.op) {
    case "add_plan": {
      const a = findActivity(op.activity) ?? activityOf(s.activities, OTHER_ID);
      const [start, end] = op.all_day ? [parseDate(op.start), addDays(parseDate(op.end), 1)] : range(op.start, op.end);
      const p: Omit<Plan, "id" | "createdAt"> = {
        name: op.name?.trim() ?? "",
        activityId: a.id,
        color: colorOf(op.color, a.color),
        allDay: !!op.all_day,
        start,
        end,
        repeat: op.repeat ?? "never",
        reminder: "activity",
        endConfirmation: "activity",
      };
      const cal = findCalendar(op.calendar);
      if (cal) p.calendar = { calendarId: cal };
      s.addPlan(p);
      return `plan "${p.name || a.name}" ${op.start}–${op.end}${p.calendar ? ` → ${calendars.find((c) => c.id === p.calendar!.calendarId)?.name ?? "calendar"}` : ""}`;
    }
    case "update_plan": {
      const p = need(s.plans.find((x) => x.id === op.id), `plan ${op.id}`);
      const patch: Partial<Plan> = {};
      if (op.name !== undefined) patch.name = op.name;
      const a = findActivity(op.activity);
      if (a) Object.assign(patch, { activityId: a.id, color: a.color });
      if (op.color && HEX.test(op.color)) patch.color = op.color;
      if (op.repeat) patch.repeat = op.repeat;
      const cal = findCalendar(op.calendar);
      if (cal !== undefined) patch.calendar = cal ? { calendarId: cal, ...(p.calendar?.calendarId === cal ? { eventId: p.calendar.eventId } : {}) } : undefined;
      if (op.start || op.end) {
        const start = op.start ? parseLocal(op.start) : p.start;
        const end = op.end ? parseLocal(op.end) : op.start ? start + (p.end - p.start) : p.end;
        if (!(end > start)) throw new Error("end must be after start");
        Object.assign(patch, { start, end });
      }
      s.updatePlan(p.id, patch);
      return `updated plan "${patch.name ?? p.name}"`;
    }
    case "delete_plan": {
      const p = need(s.plans.find((x) => x.id === op.id), `plan ${op.id}`);
      s.deletePlan(p.id);
      return `deleted plan "${p.name}"`;
    }
    case "add_actual": {
      const plan = op.plan_id ? s.plans.find((x) => x.id === op.plan_id) : undefined;
      const a = findActivity(op.activity) ?? (plan ? activityOf(s.activities, plan.activityId) : activityOf(s.activities, OTHER_ID));
      const [start, end] = range(op.start, op.end);
      if (start > Date.now()) throw new Error("actuals can't be in the future");
      const capped = Math.min(end, Date.now() + 2 * MIN);
      const occ = plan ? (op.plan_occurrence_start ? parseLocal(op.plan_occurrence_start) : plan.start) : undefined;
      s.addActual({
        name: op.name?.trim() || plan?.name || "",
        activityId: a.id,
        color: colorOf(op.color, plan?.color ?? a.color),
        start,
        end: capped,
        planKey: plan ? `${plan.id}@${occ}` : undefined,
      });
      return `actual "${op.name || plan?.name || a.name}" ${op.start}–${op.end}`;
    }
    case "update_actual": {
      const x = need(s.actuals.find((y) => y.id === op.id), `actual ${op.id}`);
      const patch: Partial<typeof x> = {};
      if (op.name !== undefined) patch.name = op.name;
      const a = findActivity(op.activity);
      if (a) Object.assign(patch, { activityId: a.id, color: a.color });
      if (op.color && HEX.test(op.color)) patch.color = op.color;
      if (op.start || op.end) {
        const start = op.start ? parseLocal(op.start) : x.start;
        const end = op.end ? parseLocal(op.end) : x.end;
        if (!(end > start)) throw new Error("end must be after start");
        Object.assign(patch, { start, end });
      }
      s.updateActual(x.id, patch);
      return `updated actual "${patch.name ?? x.name}"`;
    }
    case "delete_actual": {
      const x = need(s.actuals.find((y) => y.id === op.id), `actual ${op.id}`);
      s.deleteActual(x.id);
      return `deleted actual "${x.name}"`;
    }
    case "add_todo":
    case "update_todo": {
      const existing = op.op === "update_todo" ? need(s.todos.find((y) => y.id === op.id), `to-do ${op.id}`) : undefined;
      const a = findActivity(op.activity);
      const patch: Record<string, unknown> = {};
      if (op.name !== undefined) patch.name = op.name.trim();
      if (a) Object.assign(patch, { activityId: a.id, color: a.color });
      if (op.date !== undefined) patch.date = op.date ? parseDate(op.date) : undefined;
      if (op.time !== undefined) patch.time = op.time ? parseHM(op.time) : undefined;
      if (op.end_time !== undefined) {
        const t = (patch.time as number | undefined) ?? existing?.time;
        patch.duration = op.end_time && t !== undefined ? (parseHM(op.end_time) - t + 1440) % 1440 || undefined : undefined;
      }
      if (op.deadline !== undefined) patch.deadline = op.deadline ? parseDate(op.deadline) : undefined;
      if ((patch.time !== undefined || existing?.time !== undefined) && (patch.date ?? existing?.date) === undefined && "date" in patch) patch.time = undefined;
      if (existing) {
        if (op.op === "update_todo" && op.done !== undefined && op.done !== existing.done) s.toggleTodo(existing.id);
        if (Object.keys(patch).length) s.updateTodo(existing.id, patch);
        return `updated to-do "${(patch.name as string) ?? existing.name}"`;
      }
      const other = activityOf(s.activities, OTHER_ID);
      s.addTodo({ name: op.name?.trim() ?? "", activityId: a?.id ?? other.id, color: a?.color ?? other.color, ...patch } as Parameters<typeof s.addTodo>[0]);
      return `to-do "${op.name}"`;
    }
    case "delete_todo": {
      const t = need(s.todos.find((y) => y.id === op.id), `to-do ${op.id}`);
      s.deleteTodo(t.id);
      return `deleted to-do "${t.name}"`;
    }
    case "add_activity": {
      if (!op.name?.trim()) throw new Error("activity needs a name");
      s.addActivity({ name: op.name.trim(), color: colorOf(op.color, "#5f5f64"), reminder: s.settings.defaultReminder, endConfirmation: s.settings.defaultEndConfirmation });
      return `activity "${op.name}"`;
    }
    case "update_activity": {
      const a = need(findActivity(op.id), `activity ${op.id}`);
      s.updateActivity(a.id, { ...(op.name ? { name: op.name.trim() } : {}), ...(op.color && HEX.test(op.color) ? { color: op.color } : {}) });
      return `updated activity "${op.name ?? a.name}"`;
    }
    case "delete_activity": {
      const a = need(findActivity(op.id), `activity ${op.id}`);
      if (a.id === OTHER_ID) throw new Error(`"Other" can't be deleted`);
      s.deleteActivity(a.id);
      return `deleted activity "${a.name}"`;
    }
    case "go_to_date": {
      useUI.getState().setDate(parseDate(op.date));
      return `showing ${op.date}`;
    }
    default:
      throw new Error("unknown operation");
  }
}
