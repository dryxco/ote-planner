"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Activity, Actual, CalendarEvent, PlanOccurrence, Run, Todo } from "@/lib/types";
import { OTHER_ID, activityOf, branchLabel, useSync } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { expandPlans, isOccurrenceKept } from "@/lib/plans";
import { CELLS_PER_ROW, assignLanes, blockPaths, labelSegment, segmentBand, segmentsOf, timeAtPoint, type LaneOverflow, type LanePiece, type Segment } from "@/lib/grid";
import { HOUR, MIN, addDays, floorTo, fmtTime, fmtTime24, logicalDayRange, pad2 } from "@/lib/time";
import { roundToStep } from "@/lib/drag";
import { useBlockDrag, type GridGeometry } from "./useBlockDrag";
import { useCreateDrag } from "./useCreateDrag";
import { recentlyDragged } from "./gesture";
import { CheckIcon, PauseIcon, PlayIcon, SmallCalIcon, XIcon } from "../icons";
import { cx } from "../ui";
import { useCalendarLabel } from "@/lib/writable-calendars";
import { eventIn } from "@/lib/event-twins";
import { ActivityBar, BigStat, Legend } from "../stats-ui";
import { actualTime, attainmentRate, fulfil, syncRate } from "@/lib/stats";

/** Height of one hour row. Each row holds six 10-minute cells, left to right. */
export const ROW_H = 30;
const AXIS_W = 32;
const LINE = "var(--line)";
const CELL_LINE = "var(--cell-line)";

type Item =
  | { kind: "plan"; occ: PlanOccurrence; kept: boolean }
  | { kind: "ghost"; event: CalendarEvent; side: "plan" | "actual" }
  /** `part`: only this stretch is shown (the rest is absorbed by its to-do's planned block) */
  | { kind: "actual"; actual: Actual; part?: [number, number] }
  /** Dashed, faint: a plan (or calendar event) not yet confirmed as what actually happened. */
  | { kind: "pending"; occ: PlanOccurrence; start: number; end: number; paused?: boolean }
  | { kind: "pending-event"; event: CalendarEvent; start: number; end: number }
  /** a to-do with a time range (drawn as a block on the Plan side) */
  | { kind: "pending-todo"; todo: Todo; start: number; end: number; paused?: boolean }
  /** the paused rest of a confirmed actual */
  | { kind: "pending-rest"; actual: Actual; start: number; end: number; paused?: boolean }
  /** Dashed: the running timer. */
  | { kind: "timer"; start: number; end: number; name: string; color: string; idx?: number };

const itemKey = (it: Item) =>
  it.kind === "plan"
    ? `p:${it.occ.key}`
    : it.kind === "ghost"
      ? `g:${it.side}:${it.event.id}`
      : it.kind === "actual"
        ? `a:${it.actual.id}${it.part ? `:${it.part[0]}` : ""}`
        : it.kind === "pending"
          ? `t:${it.occ.key}`
          : it.kind === "pending-event"
            ? `te:${it.event.id}`
            : it.kind === "pending-todo"
              ? `tt:${it.todo.id}`
              : it.kind === "pending-rest"
                ? `tr:${it.actual.id}`
              : `timer${it.idx ? `:${it.idx}` : ""}`;

const itemRange = (it: Item): [number, number] =>
  it.kind === "plan"
    ? [it.occ.start, it.occ.end]
    : it.kind === "ghost"
      ? [it.event.start, it.event.end]
      : it.kind === "actual"
        ? (it.part ?? [it.actual.start, it.actual.end])
        : [it.start, it.end];

/** `range` minus `cut`: the stretches of a range outside another. */
function outside([a, b]: [number, number], [c, d]: [number, number]): [number, number][] {
  if (d <= a || c >= b) return [[a, b]];
  return [...(a < c ? [[a, c] as [number, number]] : []), ...(d < b ? [[d, b] as [number, number]] : [])];
}

/** What the confirm popup is asking about: a tentative actual from a plan or a calendar event. */
type ConfirmTarget =
  | { kind: "plan"; occ: PlanOccurrence }
  | { kind: "event"; event: CalendarEvent }
  | { kind: "todo"; todo: Todo; start: number; end: number }
  /** the paused rest of a confirmed actual */
  | { kind: "rest"; actual: Actual }
  | { kind: "timer" };
type RecordTarget = Exclude<ConfirmTarget, { kind: "timer" }>;

/** When / what a tentative actual stands for. */
function describe(t: RecordTarget, activities: Activity[]) {
  if (t.kind === "plan")
    return {
      start: t.occ.plan.runs?.[String(t.occ.start)]?.from ?? t.occ.start,
      end: t.occ.plan.runs?.[String(t.occ.start)]?.end ?? t.occ.end, name: t.occ.plan.name || activityOf(activities, t.occ.plan.activityId).name, color: t.occ.plan.color };
  if (t.kind === "event") return { start: t.event.start, end: t.event.end, name: t.event.title, color: t.event.color ?? activityOf(activities, OTHER_ID).color };
  if (t.kind === "rest") return { start: t.actual.rest!.from, end: t.actual.rest!.end, name: t.actual.name || activityOf(activities, t.actual.activityId).name, color: t.actual.color };
  return { start: t.start, end: t.end, name: t.todo.name, color: t.todo.color };
}

/** Store where a tentative block now runs (paused / resumed / moved) without confirming it. */
function setRunOf(t: RecordTarget, r: Run) {
  const st = useSync.getState();
  if (t.kind === "plan") {
    const p = st.plans.find((x) => x.id === t.occ.plan.id);
    if (p) st.updatePlan(p.id, { runs: { ...p.runs, [String(t.occ.start)]: r } });
  } else if (t.kind === "todo") st.updateTodo(t.todo.id, { run: r });
  else if (t.kind === "rest") st.updateActual(t.actual.id, { rest: { from: r.from, end: r.end ?? t.actual.rest!.end, paused: r.paused } });
}

/** Confirm a tentative actual as ground truth (a to-do is also checked off). */
function recordTarget(t: RecordTarget, start: number, end: number) {
  const s = useSync.getState();
  if (t.kind === "plan") {
    const p = t.occ.plan;
    s.addActual({ name: p.name, activityId: p.activityId, color: p.color, start, end, planKey: t.occ.key });
    const run = p.runs?.[String(t.occ.start)];
    if (run) s.updatePlan(p.id, { runs: { ...p.runs, [String(t.occ.start)]: { ...run, done: true } } });
  } else if (t.kind === "rest") {
    const a = t.actual;
    s.addActual({ name: a.name, activityId: a.activityId, color: a.color, start, end, planKey: a.planKey, sourceEventId: a.sourceEventId, todoId: a.todoId });
    s.updateActual(a.id, { rest: undefined });
  } else if (t.kind === "event") {
    s.addActual({ name: t.event.title, activityId: OTHER_ID, color: t.event.color ?? activityOf(s.activities, OTHER_ID).color, start, end, sourceEventId: t.event.id });
  } else {
    // the to-do's own pomodoro / partial records that touch this range merge into one (the union)
    let lo = start;
    let hi = end;
    const merged = new Set<string>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const a of s.actuals) {
        if (a.todoId !== t.todo.id || merged.has(a.id) || a.end < lo || a.start > hi) continue;
        merged.add(a.id);
        lo = Math.min(lo, a.start);
        hi = Math.max(hi, a.end);
        grew = true;
      }
    }
    for (const id of merged) s.deleteActual(id);
    s.addActual({ name: t.todo.name, activityId: t.todo.activityId, color: t.todo.color, start: lo, end: hi, todoId: t.todo.id });
    if (!t.todo.done) s.toggleTodo(t.todo.id);
  }
}

/** Drag a to-do from the task list onto the timeline to give it that time (it stays a to-do). */
export const TODO_DRAG_TYPE = "application/x-sync-todo";
let draggingTodoId: string | null = null;
export function setDraggingTodo(id: string | null) {
  draggingTodoId = id;
}
export const getDraggingTodo = () => draggingTodoId;

/** A ticket dragged from the board: on the timeline it becomes (or moves) its linked to-do. */
export const TICKET_DRAG_TYPE = "application/x-sync-ticket";
let draggingTicketId: string | null = null;
export function setDraggingTicket(id: string | null) {
  draggingTicketId = id;
}
/** The to-do that carries a ticket on the timeline (made on first drop: same name, a matching activity). */
function todoForTicket(ticketId: string): string | null {
  const st = useSync.getState();
  const linked = st.todos.find((x) => x.ticketId === ticketId);
  if (linked) return linked.id;
  const tk = (st.tickets ?? []).find((x) => x.id === ticketId);
  if (!tk) return null;
  const acts = st.activities.filter((a) => !a.archived);
  const act =
    acts.find((a) => a.name.trim().toLowerCase() === (tk.projectName ?? "").trim().toLowerCase()) ??
    acts.find((a) => a.id === "work") ??
    activityOf(st.activities, OTHER_ID);
  return st.addTodo({ name: tk.title, activityId: act.id, color: act.color, ticketId: tk.id });
}

const ConfirmCtx = createContext<(t: ConfirmTarget) => void>(() => {});
/** Start adjusting a tentative actual (the lifted block + Save bar) at the given times. */
const AdjustCtx = createContext<(a: Adjusting) => void>(() => {});

export function Timeline({ date, now, events }: { date: number; now: number; events: CalendarEvent[] }) {
  const { plans, actuals, activities, settings, timer, todos } = useSync();
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  // "Adjust time…": the tentative actual lifts out of the dimmed timeline to be dragged into place
  const [adjusting, setAdjusting] = useState<Adjusting | null>(null);
  const openEntry = useUI((s) => s.openEntry);
  const [dayStart, dayEnd] = logicalDayRange(date, settings.dayStart);
  const rows = Math.round((dayEnd - dayStart) / HOUR);
  const grid: GridGeometry = { dayStart, rowH: ROW_H, rows };
  const closeRow = ((settings.dayClose - settings.dayStart + 24 * 60) % (24 * 60) || 24 * 60) / 60;
  const nowInDay = now >= dayStart && now < dayEnd;
  const nowRow = Math.floor((now - dayStart) / HOUR);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const row = nowInDay ? nowRow : 4;
    el.scrollTop = Math.max(0, row * ROW_H - el.clientHeight * 0.4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const occurrences = expandPlans(plans, dayStart, dayEnd);
  const timedOcc = occurrences.filter((o) => !o.plan.allDay);
  const usedByPlan = new Set(plans.map((x) => x.sourceEventId).filter(Boolean) as string[]);
  const usedByActual = new Set([...(actuals.map((x) => x.sourceEventId).filter(Boolean) as string[]), ...(settings.skippedEventIds ?? [])]);
  const timedEvents = events.filter((e) => !e.allDay && e.end > dayStart && e.start < dayEnd);
  // All-day items belong to calendar dates (00:00–24:00), not to the 05:00–05:00 logical day:
  // otherwise tomorrow's all-day events (which start at 00:00) leak into today's view.
  const dateEnd = addDays(date, 1);
  const onThisDate = (start: number, end: number) => start < dateEnd && end > date;
  const allDayEvents = events.filter((e) => e.allDay && !eventIn(usedByPlan, e) && onThisDate(e.start, e.end));
  const allDayPlans = occurrences.filter((o) => o.plan.allDay && onThisDate(o.start, o.end));
  // After midnight but before the day starts (00:00–05:00): the previous day's timeline holds them,
  // but they're this date's too — listed above the timeline (not in it)
  const inEarly = (t: number) => t >= date && t < dayStart;
  const earlyPlans = expandPlans(plans, date, dayStart).filter((o) => !o.plan.allDay && inEarly(o.start));
  const earlyEvents = events.filter((e) => !e.allDay && inEarly(e.start) && !eventIn(usedByPlan, e));
  const earlyTodos = todos.filter((t) => t.date !== undefined && t.time !== undefined && inEarly(t.date + t.time * MIN));
  const early = [
    ...earlyPlans.map((o) => ({ at: o.start, key: o.key, kind: "plan" as const, o })),
    ...earlyEvents.map((e) => ({ at: e.start, key: e.id, kind: "event" as const, e })),
    ...earlyTodos.map((t) => ({ at: t.date! + t.time! * MIN, key: t.id, kind: "todo" as const, t })),
  ].sort((a, b) => a.at - b.at);

  const planItems: Item[] = [
    ...timedEvents.filter((e) => !eventIn(usedByPlan, e)).map((event): Item => ({ kind: "ghost", event, side: "plan" })),
    ...timedOcc.map((occ): Item => ({ kind: "plan", occ, kept: isOccurrenceKept(occ, actuals) })),
  ];

  // Ote's core loop: everything planned on the left shows up on the right as a dashed, faint
  // tentative actual. It only becomes ground truth (full color) once confirmed — as planned, or with
  // adjusted times — from the popup it opens.
  const actualItems: Item[] = timedEvents
    .filter((e) => !eventIn(usedByActual, e) && !eventIn(usedByPlan, e))
    .map((event): Item => ({ kind: "pending-event", event, start: event.start, end: event.end }));
  // to-dos given a time range (blocks on the Plan side) too — until the to-do is done. A pomodoro or
  // a partial record on it doesn't end it: working on a task doesn't require a timer.
  // (paused / resumed: only the remaining planned time, from the pause or the resume, stays dashed)
  for (const t of todos) {
    if (t.done || !t.duration || t.date === undefined || t.time === undefined) continue;
    const st = t.date + t.time * MIN;
    const from = Math.max(st, t.run?.from ?? st);
    const en = t.run?.end ?? st + t.duration * MIN;
    if (from < en && from < dayEnd && en > dayStart) actualItems.push({ kind: "pending-todo", todo: t, start: from, end: en, paused: t.run?.paused });
  }
  for (const occ of timedOcc) {
    const run = occ.plan.runs?.[String(occ.start)];
    if (run?.done) continue;
    if (!run && (isOccurrenceKept(occ, actuals) || timer?.planKey === occ.key)) continue;
    if ((occ.plan.dismissed ?? []).includes(occ.start)) continue;
    const from = run?.from ?? occ.start;
    const en = run?.end ?? occ.end;
    if (from < en) actualItems.push({ kind: "pending", occ, start: from, end: en, paused: run?.paused });
  }
  // the paused rest of confirmed actuals
  for (const a of actuals)
    if (a.rest && a.rest.from < a.rest.end && a.rest.from < dayEnd && a.rest.end > dayStart)
      actualItems.push({ kind: "pending-rest", actual: a, start: a.rest.from, end: a.rest.end, paused: a.rest.paused });
  // Pomodoros on a planned to-do only *add*: inside its planned time they're absorbed by the to-do's
  // block (not drawn twice); only what falls before / after it shows, as extra (the union).
  const plannedSpan = (todoId: string | undefined): [number, number] | null => {
    const t = todoId ? todos.find((x) => x.id === todoId) : undefined;
    if (!t || t.done || !t.duration || t.date === undefined || t.time === undefined) return null;
    const st = t.date + t.time * MIN;
    return [t.run?.from ?? st, t.run?.end ?? st + t.duration * MIN]; // only what's still tentative
  };
  for (const actual of actuals) {
    if (!(actual.end > dayStart && actual.start < dayEnd)) continue;
    const span = plannedSpan(actual.todoId);
    if (!span) actualItems.push({ kind: "actual", actual });
    else for (const part of outside([actual.start, actual.end], span)) actualItems.push({ kind: "actual", actual, part });
  }
  if (timer && timer.start < dayEnd && now > dayStart) {
    const name = timer.name || activityOf(activities, timer.activityId).name;
    const range: [number, number] = [timer.start, Math.max(now, timer.start + MIN)];
    const span = plannedSpan(timer.todoId);
    (span ? outside(range, span) : [range]).forEach(([start, end], idx) =>
      actualItems.push({ kind: "timer", start, end, name, color: timer.color, idx }),
    );
  }

  // overlapping blocks share their rows as stacked bands (points in time are pills, left out)
  const todoBlocks = todos.filter((t) => t.date !== undefined && t.time !== undefined && t.duration);
  const laneOf = (list: Item[], extra: { key: string; start: number; end: number }[] = []) =>
    assignLanes([
      ...list
        .filter((it) => {
          const [a, b] = itemRange(it);
          return !isPoint(a, b);
        })
        .map((it) => {
          const [a, b] = itemRange(it);
          return { key: itemKey(it), segs: segmentsOf(a, b, dayStart, rows) };
        }),
      ...extra.filter((x) => !isPoint(x.start, x.end)).map((x) => ({ key: x.key, segs: segmentsOf(x.start, x.end, dayStart, rows) })),
    ]);
  const planLanes = laneOf(
    planItems,
    todoBlocks.map((t) => ({ key: `todo:${t.id}`, start: t.date! + t.time! * MIN, end: t.date! + (t.time! + t.duration!) * MIN })),
  );
  const shownActual = adjusting ? actualItems.filter((it) => !isAdjusted(it, adjusting)) : actualItems;
  const actualLanes = laneOf(shownActual);
  // "+n": the blocks that didn't fit as bands, to pick from
  const [overflowList, setOverflowList] = useState<string[] | null>(null);
  const describeKey = (key: string): { name: string; color: string; open: () => void } | null => {
    if (key.startsWith("todo:")) {
      const t = todos.find((x) => x.id === key.slice(5));
      return t ? { name: t.name, color: t.color, open: () => openEntry({ mode: "edit", kind: "todo", id: t.id }) } : null;
    }
    const it = [...planItems, ...actualItems].find((x) => itemKey(x) === key);
    if (!it) return null;
    switch (it.kind) {
      case "plan":
        return { name: it.occ.plan.name || activityOf(activities, it.occ.plan.activityId).name, color: it.occ.plan.color, open: () => openEntry({ mode: "edit", kind: "plan", id: it.occ.plan.id, occurrenceStart: it.occ.start }) };
      case "ghost":
        return { name: it.event.title, color: it.event.color ?? "#8e8e8e", open: () => openEntry({ mode: "new", kind: it.side, fromEvent: it.event, date }) };
      case "actual":
        return { name: it.actual.name || activityOf(activities, it.actual.activityId).name, color: it.actual.color, open: () => openEntry({ mode: "edit", kind: "actual", id: it.actual.id }) };
      case "pending":
        return { name: it.occ.plan.name || activityOf(activities, it.occ.plan.activityId).name, color: it.occ.plan.color, open: () => setConfirm({ kind: "plan", occ: it.occ }) };
      case "pending-event":
        return { name: it.event.title, color: it.event.color ?? "#8e8e8e", open: () => setConfirm({ kind: "event", event: it.event }) };
      case "pending-todo":
        return { name: it.todo.name, color: it.todo.color, open: () => setConfirm({ kind: "todo", todo: it.todo, start: it.start, end: it.end }) };
      default:
        return null;
    }
  };

  function tapEmpty(column: "plan" | "actual", t: number) {
    // a plain click makes a 1-minute (point) entry at the clicked 5-minute step; drag for a range.
    // An actual can't be later than now: a tap past it plants the flag at now.
    const at = column === "actual" ? Math.min(floorTo(t, 5), floorTo(now, 1)) : floorTo(t, 5);
    openEntry({ mode: "new", kind: column, start: at, end: at + MIN });
  }

  function selectRange(column: "plan" | "actual", start: number, end: number) {
    if (column === "actual") {
      const cap = roundToStep(Date.now() + 2.5 * MIN); // actuals only up to now
      if (start >= cap) return;
      end = Math.min(end, cap);
    }
    openEntry({ mode: "new", kind: column, start, end });
  }

  return (
    <ConfirmCtx.Provider value={setConfirm}>
    <AdjustCtx.Provider value={setAdjusting}>
    <div className="relative flex min-h-0 flex-1 flex-col">
      {confirm && confirm.kind !== "timer" && <ConfirmActual target={confirm} now={now} onClose={() => setConfirm(null)} onAdjust={setAdjusting} />}
      {adjusting && <AdjustBar adj={adjusting} onDone={() => setAdjusting(null)} />}
      {overflowList && (
        <div data-overflow-list className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 px-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:items-center" onClick={() => setOverflowList(null)}>
          <div className="animate-fade w-full max-w-[360px] rounded-[16px] bg-surface p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="px-2 pb-1 pt-1 text-[12px] font-medium text-fg/50">Also here</p>
            {overflowList.map((k) => {
              const d = describeKey(k);
              return (
                d && (
                  <button
                    key={k}
                    onClick={() => {
                      setOverflowList(null);
                      d.open();
                    }}
                    className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left text-[14px] hover:bg-fg/[0.05]"
                  >
                    <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: d.color }} />
                    <span className="truncate">{d.name}</span>
                  </button>
                )
              );
            })}
          </div>
        </div>
      )}
      {confirm?.kind === "timer" && <RenameTimer onClose={() => setConfirm(null)} />}
      <div className="grid px-3 pb-1.5 text-center text-[13px] font-medium text-fg/70" style={{ gridTemplateColumns: `1fr ${AXIS_W}px 1fr` }}>
        <span>Plan</span>
        <span />
        <span>Actual</span>
      </div>

      {(allDayPlans.length > 0 || allDayEvents.length > 0 || early.length > 0) && (
        <div className="grid gap-y-1 px-3 pb-1.5" style={{ gridTemplateColumns: `1fr ${AXIS_W}px 1fr` }}>
          <div className="flex flex-col gap-1">
            {allDayPlans.map((o) => (
              <button
                key={o.key}
                onClick={() => openEntry({ mode: "edit", kind: "plan", id: o.plan.id, occurrenceStart: o.start })}
                className="truncate rounded-[6px] border px-1.5 py-[3px] text-left text-[11px]"
                style={{ borderColor: borderColor(o.plan.color), background: faint(o.plan.color) }}
              >
                {o.plan.name || activityOf(activities, o.plan.activityId).name}
              </button>
            ))}
            {allDayEvents.map((e) => (
              <button
                key={e.id}
                onClick={() => openEntry({ mode: "new", kind: "plan", fromEvent: e, date })}
                className="flex items-center gap-1 truncate rounded-[6px] px-1.5 py-[3px] text-left text-[11px] text-fg/80"
                style={{ background: eventTint(e.color) }}
              >
                <SmallCalIcon size={10} className="shrink-0" style={{ color: e.color }} />
                <span className="truncate">{e.title}</span>
              </button>
            ))}
            {early.map((x) => {
              const time = <span className="shrink-0 tabular text-fg/55">{fmtTime(x.at)}</span>;
              if (x.kind === "plan")
                return (
                  <button
                    key={x.key}
                    data-early-item
                    onClick={() => openEntry({ mode: "edit", kind: "plan", id: x.o.plan.id, occurrenceStart: x.o.start })}
                    className="flex items-center gap-1.5 truncate rounded-[6px] border px-1.5 py-[3px] text-left text-[11px]"
                    style={{ borderColor: borderColor(x.o.plan.color), background: faint(x.o.plan.color) }}
                  >
                    {time}
                    <span className="truncate">{x.o.plan.name || activityOf(activities, x.o.plan.activityId).name}</span>
                  </button>
                );
              if (x.kind === "event")
                return (
                  <button
                    key={x.key}
                    data-early-item
                    onClick={() => openEntry({ mode: "new", kind: "plan", fromEvent: x.e, date })}
                    className="flex items-center gap-1.5 truncate rounded-[6px] px-1.5 py-[3px] text-left text-[11px] text-fg/80"
                    style={{ background: eventTint(x.e.color) }}
                  >
                    {time}
                    <SmallCalIcon size={10} className="shrink-0" style={{ color: x.e.color }} />
                    <span className="truncate">{x.e.title}</span>
                  </button>
                );
              return (
                <button
                  key={x.key}
                  data-early-item
                  onClick={() => openEntry({ mode: "edit", kind: "todo", id: x.t.id })}
                  className={cx("flex items-center gap-1.5 truncate rounded-[6px] border border-fg/10 px-1.5 py-[3px] text-left text-[11px]", x.t.done && "text-fg/45 line-through")}
                >
                  {time}
                  <span className="truncate">{x.t.name}</span>
                </button>
              );
            })}
          </div>
          <span />
          <div />
        </div>
      )}

      <div ref={scrollRef} data-timeline-scroll className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(var(--tabbar-h)+110px)] pt-3">
        <div className="relative grid" style={{ gridTemplateColumns: `1fr ${AXIS_W}px 1fr`, height: rows * ROW_H }}>
          <Column
            side="plan"
            items={planItems}
            grid={grid}
            closeRow={closeRow}
            onTap={(t) => tapEmpty("plan", t)}
            onSelect={(s, e) => selectRange("plan", s, e)}
            lanes={planLanes}
            onOverflow={setOverflowList}
          >
            {todos
              .filter((t) => t.date !== undefined && t.time !== undefined)
              .map((t) => ({ t, at: t.date! + t.time! * MIN }))
              .filter(({ at }) => at >= dayStart && at < dayEnd)
              .map(({ t, at }) =>
                t.duration ? (
                  <TodoBlock key={t.id} todo={t} start={at} end={at + t.duration * MIN} grid={grid} />
                ) : (
                  <TimedTodo key={t.id} todo={t} row={Math.floor((at - dayStart) / HOUR)} frac={((at - dayStart) % HOUR) / HOUR} />
                ),
              )}
          </Column>

          <div className="relative">
            {Array.from({ length: rows }, (_, r) => {
              const hr = new Date(dayStart + r * HOUR).getHours();
              return (
                <div
                  key={r}
                  className={cx(
                    "absolute inset-x-0 flex items-center justify-center text-[11.5px] tabular",
                    nowInDay && r === nowRow ? "font-semibold text-[#ff453a]" : "text-fg/50",
                  )}
                  style={{ top: r * ROW_H, height: ROW_H }}
                >
                  {pad2(hr)}
                </div>
              );
            })}
          </div>

          <Column
            side="actual"
            items={shownActual}
            lanes={actualLanes}
            onOverflow={setOverflowList}
            grid={grid}
            closeRow={closeRow}
            onTap={(t) => tapEmpty("actual", t)}
            onSelect={(s, e) => selectRange("actual", s, e)}
          >
            {nowInDay && <NowMarker row={nowRow} frac={(now - dayStart - nowRow * HOUR) / HOUR} label={fmtTime24(now)} />}
            {adjusting && <AdjustBlock adj={adjusting} grid={grid} onChange={(start, end) => setAdjusting({ ...adjusting, start, end })} />}
          </Column>
          {/* everything else dims while one block is being adjusted */}
          {adjusting && <div data-adjust-dim className="absolute -inset-x-1 -inset-y-1 z-[44] rounded-[12px] bg-black/45" />}
        </div>

        <DaySummary dayStart={dayStart} dayEnd={dayEnd} now={now} />
      </div>
    </div>
    </AdjustCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

interface Look {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  z: number;
  hidden?: boolean;
  shadow?: boolean;
  className?: string;
}

/** Pixel width of the column a block is drawn in (for the SVG outline). */
const ColumnWidth = createContext(0);
const ColumnRows = createContext(24);
/** Per column: block key -> row -> its band, for rows it shares with other blocks. */
const EMPTY_LANES = new Map<string, Map<number, LanePiece[]>>();
const LaneCtx = createContext<Map<string, Map<number, LanePiece[]>>>(EMPTY_LANES);

/** Which edges of the day a block runs past (drawn as cut off there). */
function openEdges(start: number, end: number, grid: GridGeometry) {
  return { openTop: start < grid.dayStart, openBottom: end > grid.dayStart + grid.rows * HOUR };
}

/** Calendar events: the calendar's own color, faint — like every block that isn't a confirmed actual. */
export function eventTint(color: string | undefined) {
  return faint(color ?? "#8e8e8e");
}

/** Not (yet) ground truth: plans, calendar events and tentative actuals are drawn see-through. */
export function faint(color: string) {
  return `color-mix(in srgb, ${color} 30%, transparent)`;
}

/** Tentative actuals (Actual column, not yet confirmed): brighter than plans, softer than confirmed. */
export function tentative(color: string) {
  return `color-mix(in srgb, ${color} 55%, transparent)`;
}

function borderColor(color: string) {
  return `color-mix(in srgb, ${color} 65%, var(--outline-mix))`;
}

/** Vertical red line at the current minute inside the current hour row, with a time badge on top. */
function NowMarker({ row, frac, label }: { row: number; frac: number; label: string }) {
  return (
    <div className="pointer-events-none absolute z-40" style={{ top: row * ROW_H, left: `${frac * 100}%`, height: ROW_H }} data-now>
      <div className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-[#ff3b30]" />
      <div className="absolute top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff3b30] px-[7px] py-[1px] text-[11px] font-semibold text-white tabular shadow-[0_0_0_2px_var(--marker-ring)]">
        {label}
      </div>
    </div>
  );
}

function Column({
  side,
  items,
  grid,
  closeRow,
  onTap,
  onSelect,
  lanes,
  onOverflow,
  children,
}: {
  side: "plan" | "actual";
  items: Item[];
  grid: GridGeometry;
  closeRow: number;
  onTap: (t: number) => void;
  onSelect: (start: number, end: number) => void;
  lanes?: { lanes: Map<string, Map<number, LanePiece[]>>; overflow: LaneOverflow[] };
  onOverflow?: (keys: string[]) => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const create = useCreateDrag({ grid, onSelect });
  const [drop, setDrop] = useState<{ start: number; end: number; name: string; color: string } | null>(null);
  const todoDropAt = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TODO_DRAG_TYPE) && !e.dataTransfer.types.includes(TICKET_DRAG_TYPE)) return null;
    // the block starts at the 5-minute step under the pointer
    const t = Math.round(timeAtPoint(ref.current!, e.clientX, e.clientY, grid.dayStart, grid.rowH, grid.rows) / (5 * MIN)) * 5 * MIN;
    return t;
  };
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const bg: CSSProperties = {
    backgroundColor: side === "plan" ? "var(--surface)" : "transparent",
    backgroundImage: `linear-gradient(to bottom, ${LINE} 1px, transparent 1px), linear-gradient(to right, ${CELL_LINE} 1px, transparent 1px)`,
    backgroundSize: `100% ${ROW_H}px, calc(100% / ${CELLS_PER_ROW}) ${ROW_H}px`,
    backgroundPosition: "0 0, 0 0",
  };
  return (
    <div
      ref={ref}
      data-column={side}
      onPointerDown={create.onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        const t = todoDropAt(e);
        if (t === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const st = useSync.getState();
        const ticket = e.dataTransfer.types.includes(TICKET_DRAG_TYPE) ? (st.tickets ?? []).find((x) => x.id === draggingTicketId) : undefined;
        const todo = ticket ? st.todos.find((x) => x.ticketId === ticket.id) : st.todos.find((x) => x.id === draggingTodoId);
        const len = (todo?.duration || 60) * MIN;
        if (drop?.start !== t) setDrop({ start: t, end: t + len, name: todo?.name ?? ticket?.title ?? "", color: todo?.color ?? "#8e8e8e" });
      }}
      onDragLeave={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setDrop(null);
      }}
      onDrop={(e) => {
        const t = todoDropAt(e);
        const ticketId = e.dataTransfer.getData(TICKET_DRAG_TYPE);
        const id = ticketId ? todoForTicket(ticketId) : e.dataTransfer.getData(TODO_DRAG_TYPE);
        setDrop(null);
        if (t === null || !id) return;
        e.preventDefault();
        const todo = useSync.getState().todos.find((x) => x.id === id);
        if (!todo) return;
        if (side === "actual") {
          // dropped on Actual: done without a plan — record it (linked, checked off), don't plan it
          const st = useSync.getState();
          st.addActual({ name: todo.name, activityId: todo.activityId, color: todo.color, start: t, end: t + (todo.duration || 60) * MIN, todoId: todo.id });
          if (!todo.done) st.toggleTodo(todo.id);
          return;
        }
        const day = new Date(t);
        day.setHours(0, 0, 0, 0);
        useSync.getState().updateTodo(id, {
          date: day.getTime(),
          time: Math.round((t - day.getTime()) / MIN),
          duration: todo.duration || 60,
        });
      }}
      onClick={(e) => {
        if (create.justDragged.current || recentlyDragged()) return;
        if (e.target !== ref.current && !(e.target as HTMLElement).dataset.empty) return;
        onTap(timeAtPoint(ref.current!, e.clientX, e.clientY, grid.dayStart, grid.rowH, grid.rows));
      }}
      className="relative touch-pan-y select-none rounded-[12px] [-webkit-touch-callout:none]"
      style={bg}
    >
      <ColumnWidth.Provider value={width}>
      <ColumnRows.Provider value={grid.rows}>
      <LaneCtx.Provider value={lanes?.lanes ?? EMPTY_LANES}>
      {/* after the day close time */}
      {closeRow < grid.rows && <div data-empty="1" className="absolute inset-x-0 bottom-0 rounded-b-[12px] bg-[var(--dim)]" style={{ top: closeRow * ROW_H }} />}

      {items.map((it) => (
        <ItemBlocks key={itemKey(it)} item={it} side={side} grid={grid} />
      ))}

      {create.range && (
        <Segments
          segs={segmentsOf(create.range[0], create.range[1], grid.dayStart, grid.rows)}
          className=""
          look={{ fill: "rgba(10,132,255,0.28)", stroke: "#0a84ff", z: 30 }}
          badge={`${fmtTime(create.range[0])} – ${fmtTime(create.range[1])}`}
          dataAttr="selection"
        />
      )}
      {drop && (
        <Segments
          segs={segmentsOf(drop.start, drop.end, grid.dayStart, grid.rows)}
          className="pointer-events-none"
          look={{ fill: faint(drop.color), stroke: drop.color, dashed: true, z: 45 }}
          label={drop.name}
          labelClass="text-fg/85"
          badge={`${fmtTime(drop.start)} – ${fmtTime(drop.end)}`}
          dataAttr="drop-preview"
        />
      )}
      {children}
      {/* more blocks overlap here than fit as bands: "+n" opens the list */}
      {lanes?.overflow.map((o) => (
        <button
          key={`${o.row}:${o.x1}`}
          data-lane-overflow
          aria-label={`${o.keys.length} more here`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOverflow?.(o.keys);
          }}
          className="absolute z-50 -translate-x-full rounded-full bg-fg px-1.5 text-[10px] font-semibold leading-[15px] text-bg shadow"
          style={{ top: o.row * ROW_H + ROW_H - 17, left: `calc(${o.x1 * 100}% - 3px)` }}
        >
          +{o.keys.length}
        </button>
      ))}
      </LaneCtx.Provider>
      </ColumnRows.Provider>
      </ColumnWidth.Provider>
    </div>
  );
}

let measureEl: HTMLSpanElement | null = null;
const measured = new Map<string, number>();
/**
 * Rendered width of a 12px label, measured in the page itself (a canvas doesn't get the web font,
 * which made labels look wider than they are). Cached.
 */
function textWidth(text: string, fontSize = 12): number {
  if (fontSize !== 12) return (textWidth(text) * fontSize) / 12;
  const hit = measured.get(text);
  if (hit !== undefined) return hit;
  if (!measureEl) {
    measureEl = document.createElement("span");
    measureEl.setAttribute("aria-hidden", "true");
    Object.assign(measureEl.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre", fontSize: "12px", left: "-9999px", top: "0" });
    document.body.appendChild(measureEl);
  }
  measureEl.textContent = text;
  const w = measureEl.getBoundingClientRect().width;
  measureEl.textContent = ""; // don't leave stray label text in the page
  if (document.fonts?.status === "loaded") measured.set(text, w); // don't cache fallback-font widths
  return w;
}

/**
 * Split a label into consecutive parts, one per piece width, on whole characters (at a space when
 * there is one). The last part takes the rest (and gets truncated if it still doesn't fit).
 */
function splitFlow(text: string, widths: number[], fs: number[]): string[] {
  const out: string[] = [];
  let i = 0;
  widths.forEach((w, k) => {
    while (text[i] === " ") i++;
    if (k === widths.length - 1) {
      out.push(text.slice(i));
      i = text.length;
      return;
    }
    let j = i;
    while (j < text.length && textWidth(text.slice(i, j + 1), fs[k]) <= w) j++;
    if (j < text.length && text[j] !== " " && j > i && text[j - 1] !== " ") {
      // mid-word: break at the space instead when the piece stays mostly full, or when splitting
      // would strand fewer than 3 letters on either side ("yoga tim" / "e")
      const sp = text.lastIndexOf(" ", j);
      const nextSp = text.indexOf(" ", j);
      const wordEnd = nextSp === -1 ? text.length : nextSp;
      const head = j - Math.max(sp + 1, i);
      const stranded = head < 3 || wordEnd - j < 3;
      if (sp > i) j = sp; // words stay whole when there's an earlier space to break at
      else if (sp <= i && stranded) {
        // a word this piece can't finish: at least 3 letters on each side, or none here
        const cut = Math.min(j, wordEnd - 3);
        j = cut - i >= 3 ? cut : i;
      }
    }
    out.push(text.slice(i, j).trimEnd());
    i = j;
  });
  return out;
}

/** How many characters of `text` show in `w` px (with "…" when it's cut). */
function fitChars(text: string, w: number, fs = 12): number {
  if (w <= 0) return 0;
  if (textWidth(text, fs) <= w) return text.length;
  let n = 0;
  while (n < text.length && textWidth(text.slice(0, n + 1) + "…", fs) <= w) n++;
  return n;
}

/** A stretch of a block that can hold a line of label text (px, within the column). */
interface LabelArea {
  row: number;
  /** the piece the text is drawn in (its box is the reference for left/top) */
  seg: number;
  left: number;
  right: number;
  top: number;
  height: number;
  fs: number;
}
interface LabelPart {
  area: LabelArea;
  text: string;
  /** where the lead (a checkbox) goes in this area */
  lead?: "start" | "end";
  center?: boolean;
  /** the name again, faint, in a shared row's band (so stacked bands can be told apart) */
  echo?: boolean;
}

/**
 * Where a block's label goes. Pieces next to each other in a row (a full-height piece and an overlap
 * band) are one strip as tall as they all are, so a label isn't stuck in a 10-minute sliver; then
 * whichever of these shows the most of the text wins: the whole label in one area, or the label
 * running on row by row with the lead (checkbox) before it or at the very end.
 */
function placeLabel(segs: Segment[], colW: number, text: string, lead: number): LabelPart[] {
  const PAD = 4;
  const MIN_H = 11;
  const boxes = segs.map((s, i) => {
    const b = segmentBand(s, ROW_H);
    return { i, row: s.row, x0: s.x0, x1: s.x1, left: s.x0 * colW + 1.5, right: s.x1 * colW - 1.5, top: b.top, bottom: b.top + b.height };
  });
  const area = (bs: typeof boxes): LabelArea | null => {
    const top = Math.max(...bs.map((b) => b.top));
    const height = Math.min(...bs.map((b) => b.bottom)) - top;
    if (height < MIN_H) return null;
    return { row: bs[0].row, seg: bs[0].i, left: bs[0].left, right: bs[bs.length - 1].right, top, height, fs: height >= 18 ? 12 : 10 };
  };
  const cands: LabelArea[] = [];
  const rows = [...new Set(boxes.map((b) => b.row))].sort((a, b) => a - b);
  for (const r of rows) {
    const inRow = boxes.filter((b) => b.row === r).sort((a, b) => a.x0 - b.x0);
    let run: typeof boxes = [];
    const flush = () => {
      if (run.length > 1) {
        const a = area(run);
        if (a) cands.push(a);
      }
      run = [];
    };
    for (const b of inRow) {
      if (run.length && Math.abs(b.x0 - run[run.length - 1].x1) > 1e-6) flush();
      run.push(b);
      const a = area([b]);
      if (a) cands.push(a);
    }
    flush();
  }
  if (!cands.length) return [];
  const room = (a: LabelArea) => Math.max(0, a.right - a.left - 2 * PAD);
  const usable = (a: LabelArea) => (room(a) < 20 ? 0 : room(a));
  // best area per row: the widest, then the tallest
  const perRow = rows
    .map((r) => cands.filter((a) => a.row === r).sort((a, b) => room(b) - room(a) || b.height - a.height)[0])
    .filter(Boolean);

  type Option = { parts: LabelPart[]; shown: number; rank: number };
  const options: Option[] = [];
  // the whole label in one area
  for (const a of cands) {
    const w = usable(a) - lead;
    const n = fitChars(text, w, a.fs);
    options.push({ parts: [{ area: a, text, lead: lead ? "start" : undefined, center: n === text.length }], shown: n, rank: 0 });
  }
  // running on from row to row (only through consecutive rows)
  const consecutive = perRow.length > 1 && perRow.every((a, i) => i === 0 || a.row === perRow[i - 1].row + 1);
  if (consecutive) {
    const flowOpt = (leadAt: "start" | "end", rank: number) => {
      const ws = perRow.map((a, i) => {
        const w = usable(a) - (leadAt === "start" && i === 0 ? lead : 0) - (leadAt === "end" && i === perRow.length - 1 ? lead : 0);
        return w < 20 ? 0 : w;
      });
      const fs = perRow.map((a) => a.fs);
      const texts = splitFlow(text, ws, fs);
      const shown = texts.reduce((n, t, i) => n + fitChars(t, ws[i], fs[i]), 0);
      const parts = perRow.map((a, i) => ({ area: a, text: texts[i] ?? "" }) as LabelPart);
      if (lead) parts[leadAt === "start" ? 0 : parts.length - 1].lead = leadAt;
      options.push({ parts: parts.filter((p) => p.text || p.lead), shown, rank });
    };
    flowOpt("start", 1);
    if (lead) flowOpt("end", 2);
  }
  // most text shown; on a tie the simpler layout, then the roomier area
  options.sort((a, b) => b.shown - a.shown || a.rank - b.rank || room(b.parts[0].area) - room(a.parts[0].area));
  const parts = options[0].parts;
  const labelled = new Set(parts.map((p) => p.area.row));
  for (const a of perRow) {
    const shared = segs.some((x) => x.row === a.row && (x.lanes ?? 1) > 1);
    if (shared && !labelled.has(a.row) && fitChars(text, usable(a), a.fs) >= Math.min(3, text.length)) {
      parts.push({ area: a, text, echo: true, center: fitChars(text, usable(a), a.fs) === text.length });
    }
  }
  return parts;
}

/** Renders one time range as wrapped row segments. */
function Segments({
  segs: rawSegs,
  laneKey,
  flowText,
  flowLead = 0,
  lead,
  className,
  style,
  label,
  labelClass,
  badge,
  dataAttr,
  onClick,
  onPointerDown,
  handles,
  extra,
  title,
  look,
  openTop,
  openBottom,
}: {
  openTop?: boolean;
  openBottom?: boolean;
  segs: Segment[];
  /** this block's key in the column's lane layout (overlapping blocks share rows as bands) */
  laneKey?: string;
  /** the label as plain text: when it doesn't fit one piece, it runs on across the row breaks */
  flowText?: string;
  /** px taken at the start of the first piece by `extra` (a checkbox) when the label runs on */
  flowLead?: number;
  /** drawn before the label in that space (defaults to `extra`) */
  lead?: ReactNode;
  className: string;
  /** how the block is painted (one merged, rounded shape) */
  look?: Look;
  style?: CSSProperties;
  label?: ReactNode;
  labelClass?: string;
  badge?: string;
  dataAttr?: string;
  onClick?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  /** resize handles on the first segment's left edge and the last segment's right edge */
  handles?: boolean;
  extra?: ReactNode;
  title?: string;
}) {
  const colW = useContext(ColumnWidth);
  const colRows = useContext(ColumnRows);
  const laneMap = useContext(LaneCtx);
  const mine = laneKey ? laneMap.get(laneKey) : undefined;
  // where it shares a row, a segment becomes pieces: full height outside the overlap, a band inside
  const segs = mine
    ? rawSegs.flatMap((s) => {
        const ps = mine.get(s.row);
        return !ps ? [s] : ps.filter((p) => !p.hidden).map((p) => ({ ...s, x0: p.x0, x1: p.x1, lane: p.lane, lanes: p.lanes }));
      })
    : rawSegs;
  if (segs.length === 0) return null;
  // label where it reads best: the widest full-height segment, else the widest band
  const full = segs.filter((x) => (x.lanes ?? 1) <= 1);
  const li = full.length ? segs.indexOf(full[labelSegment(full)]) : labelSegment(segs);
  // a plain-text label is placed by area (see placeLabel); the lead (checkbox) goes with it
  const placed = flowText && colW > 0 ? placeLabel(segs, colW, flowText, flowLead) : null;
  const leadNode = lead ?? extra;
  return (
    <>
      {look && colW > 0 && (
        <svg
          className={cx("pointer-events-none absolute left-0 top-0 overflow-visible", look.className)}
          width={colW}
          height={colRows * ROW_H}
          style={{
            zIndex: look.z,
            opacity: look.hidden ? 0 : 1,
            filter: look.shadow ? "drop-shadow(0 6px 14px rgba(0,0,0,0.75))" : undefined,
            // cut exactly along the column's rounded outline (blocks running past the day edges)
            clipPath: look.shadow ? undefined : "inset(0 round 12px)",
          }}
          aria-hidden
        >
          {blockPaths(segs, colW, ROW_H, { radius: 7, openTop, openBottom }).map((d, i) => (
            <path
              key={i}
              d={d}
              style={{ fill: look.fill, stroke: look.stroke ?? "none" }}
              strokeWidth={look.stroke ? (look.strokeWidth ?? 1.6) : 0}
              strokeDasharray={look.dashed ? "4.5 3.5" : undefined}
              strokeLinecap="round"
            />
          ))}
        </svg>
      )}
      {segs.map((s, i) => (
        <div
          key={`${s.row}:${s.x0}`}
          {...(dataAttr ? { [`data-${dataAttr}`]: "1" } : {})}
          data-seg={i}
          title={title}
          onClick={onClick}
          onPointerDown={onPointerDown}
          className={cx("absolute flex items-center justify-center rounded-[7px] px-1", placed ? "overflow-visible" : "overflow-hidden", className)}
          style={{
            ...style,
            ...(look ? { zIndex: look.z, opacity: look.hidden ? 0 : 1 } : {}),
            ...(() => {
              const b = segmentBand(s, ROW_H);
              return { top: b.top, height: b.height };
            })(),
            left: `calc(${s.x0 * 100}% + 1.5px)`,
            width: `calc(${(s.x1 - s.x0) * 100}% - 3px)`,
          }}
        >
          {placed ? (
            placed
              .filter((p) => p.area.seg === i)
              .map((p, k) => {
                const b = segmentBand(s, ROW_H);
                return (
                  <span
                    key={k}
                    className={cx("pointer-events-none absolute flex items-center gap-0", p.center && "justify-center")}
                    style={{ left: p.area.left - (s.x0 * colW + 1.5), top: p.area.top - b.top, width: p.area.right - p.area.left, height: p.area.height, paddingLeft: 4, paddingRight: 4 }}
                  >
                    {p.lead === "start" && <span className="pointer-events-auto flex shrink-0">{leadNode}</span>}
                    {p.text && (
                      <span className={cx("min-w-0 truncate leading-none", p.area.fs === 12 ? "text-[12px]" : "text-[10px]", labelClass, p.echo && "opacity-50")}>{p.text}</span>
                    )}
                    {p.lead === "end" && <span className="pointer-events-auto ml-auto flex shrink-0">{leadNode}</span>}
                  </span>
                );
              })
          ) : (
            i === li &&
            label !== undefined &&
            (s.lanes ?? 1) < 3 && (
              <span className={cx("pointer-events-none truncate leading-none", (s.lanes ?? 1) > 1 ? "text-[10px]" : "text-[12px]", labelClass)}>{label}</span>
            )
          )}
          {i === li && !placed && extra}
          {handles && i === 0 && (
            <div
              data-drag-handle="start"
              onPointerDown={onPointerDown}
              aria-label="Drag to change start"
              className="absolute inset-y-0 left-0 w-[8px] cursor-ew-resize touch-none"
            />
          )}
          {handles && i === segs.length - 1 && (
            <div
              data-drag-handle="end"
              onPointerDown={onPointerDown}
              aria-label="Drag to change end"
              className="absolute inset-y-0 right-0 w-[8px] cursor-ew-resize touch-none"
            />
          )}
        </div>
      ))}
      {badge && (
        <div
          className="pointer-events-none absolute z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-fg px-2 py-[2px] text-[11px] font-semibold text-bg tabular shadow-lg"
          style={{ top: segs[0].row * ROW_H - 20, left: `${((segs[0].x0 + segs[0].x1) / 2) * 100}%` }}
        >
          {badge}
        </div>
      )}
    </>
  );
}

function ItemBlocks({ item, side, grid }: { item: Item; side: "plan" | "actual"; grid: GridGeometry }) {
  if (item.kind === "plan") return <PlanBlocks item={item} grid={grid} />;
  if (item.kind === "actual") return <ActualBlocks actual={item.actual} part={item.part} grid={grid} />;
  return <StaticBlocks item={item} side={side} grid={grid} />;
}

function StaticBlocks({ item, side, grid }: { item: Item; side: "plan" | "actual"; grid: GridGeometry }) {
  const openEntry = useUI((s) => s.openEntry);
  const date = useUI((s) => s.date);
  const activities = useSync((s) => s.activities);
  const confirm = useContext(ConfirmCtx);
  const [s, e] = itemRange(item);
  const segs = segmentsOf(s, e, grid.dayStart, grid.rows);
  const calLabel = useCalendarLabel(item.kind === "ghost" ? item.event.calendarId : undefined);

  if (item.kind === "ghost") {
    return (
      <Segments
        segs={segs}
        laneKey={itemKey(item)}
        dataAttr="ghost"
        {...openEdges(s, e, grid)}
        title={calLabel ? `${item.event.title} — ${calLabel}` : item.event.title}
        className="cursor-pointer"
        look={{ fill: eventTint(item.event.color), z: 10 }}
        label={item.event.title}
        flowText={item.event.title}
        labelClass="text-fg/80"
        onClick={(ev) => {
          ev.stopPropagation();
          openEntry({ mode: "new", kind: side, fromEvent: item.event, date });
        }}
      />
    );
  }

  if (item.kind === "pending" || item.kind === "pending-event" || item.kind === "pending-todo" || item.kind === "pending-rest") {
    const target: RecordTarget =
      item.kind === "pending"
        ? { kind: "plan", occ: item.occ }
        : item.kind === "pending-event"
          ? { kind: "event", event: item.event }
          : item.kind === "pending-rest"
            ? { kind: "rest", actual: item.actual }
            : { kind: "todo", todo: item.todo, start: item.start, end: item.end };
    const d = describe(target, activities);
    const color = d.color;
    const name = item.kind !== "pending-event" && item.paused ? `${d.name} · paused` : d.name;
    const ask = (ev: React.MouseEvent) => {
      ev.stopPropagation();
      if (recentlyDragged()) return;
      confirm(target);
    };
    if (isPoint(s, e)) return <PendingPoint target={target} name={name} color={color} start={s} end={e} grid={grid} onClick={ask} />;
    return <PendingBlocks segs={segs} laneKey={itemKey(item)} target={target} name={name} color={color} start={s} end={e} grid={grid} onClick={ask} />;
  }

  if (item.kind === "timer") {
    return (
      <Segments
        segs={segs}
        laneKey={itemKey(item)}
        dataAttr="timer"
        {...openEdges(s, e, grid)}
        title={item.name}
        className="cursor-pointer"
        look={{ fill: "var(--surface-0)", stroke: borderColor(item.color), dashed: true, z: 20, className: "animate-pulse" }}
        label={item.name}
        flowText={item.name}
        labelClass="text-fg/90"
        onClick={(ev) => {
          ev.stopPropagation();
          if (recentlyDragged()) return;
          confirm({ kind: "timer" });
        }}
      />
    );
  }
  return null;
}

function PlanBlocks({ item, grid }: { item: Extract<Item, { kind: "plan" }>; grid: GridGeometry }) {
  const activities = useSync((s) => s.activities);
  const updatePlan = useSync((s) => s.updatePlan);
  const openEntry = useUI((s) => s.openEntry);
  const { occ, kept } = item;
  const drag = useBlockDrag({
    start: occ.start,
    end: occ.end,
    grid,
    enabled: true,
    onCommit: (start, end) => {
      // Repeating plans shift the whole series, like editing an occurrence in the sheet.
      const seriesStart = occ.plan.start + (start - occ.start);
      updatePlan(occ.plan.id, { start: seriesStart, end: seriesStart + (end - start) });
    },
    // dropped on the task list: this plan (occurrence) becomes a timed to-do in the same slot
    onDropOnTasks: () => planToTodo(occ),
  });
  const name = occ.plan.name || activityOf(activities, occ.plan.activityId).name;
  const stroke = borderColor(occ.plan.color);
  if (isPoint(occ.start, occ.end)) {
    const at = drag.preview?.start ?? occ.start;
    return (
      <PointPill
        at={at}
        grid={grid}
        dataAttr="plan"
        title={name}
        fill={faint(occ.plan.color)}
        stroke={stroke}
        label={name}
        badge={drag.preview ? fmtTime(at) : undefined}
        onPointerDown={drag.onPointerDown}
        onClick={(ev) => {
          ev.stopPropagation();
          if (drag.justDragged.current || recentlyDragged()) return;
          openEntry({ mode: "edit", kind: "plan", id: occ.plan.id, occurrenceStart: occ.start });
        }}
      />
    );
  }
  const label = (
    <span className="flex min-w-0 items-center gap-1">
      {kept && <CheckIcon size={10} className="shrink-0 text-fg/70" />}
      <span className="truncate">{name}</span>
    </span>
  );
  return (
    <>
      {/* The original segments stay mounted (hidden) while dragging: the touched element must not
          unmount mid-gesture, or touch events stop reaching the document. */}
      <Segments
        segs={segmentsOf(occ.start, occ.end, grid.dayStart, grid.rows)}
        laneKey={`p:${occ.key}`}
        dataAttr="plan"
        {...openEdges(occ.start, occ.end, grid)}
        title={name}
        className="cursor-pointer touch-pan-y [-webkit-touch-callout:none]"
        look={{ fill: faint(occ.plan.color), stroke, z: 20, hidden: drag.dragging }}
        label={label}
        flowText={name}
        lead={kept ? <CheckIcon size={10} className="mr-1 shrink-0 text-fg/70" /> : undefined}
        flowLead={kept ? 14 : 0}
        labelClass="text-fg/90"
        onPointerDown={drag.onPointerDown}
        handles
        onClick={(ev) => {
          ev.stopPropagation();
          if (drag.justDragged.current || recentlyDragged()) return;
          openEntry({ mode: "edit", kind: "plan", id: occ.plan.id, occurrenceStart: occ.start });
        }}
      />
      {drag.preview && !drag.overTasks && (
        <Segments
          segs={segmentsOf(drag.preview.start, drag.preview.end, grid.dayStart, grid.rows)}
          className="pointer-events-none"
          look={{ fill: faint(occ.plan.color), stroke: "var(--fg)", z: 40, shadow: true }}
          label={label}
          labelClass="text-fg/90"
          badge={`${fmtTime(drag.preview.start)} – ${fmtTime(drag.preview.end)}`}
          dataAttr="drag-preview"
          {...openEdges(drag.preview.start, drag.preview.end, grid)}
        />
      )}
    </>
  );
}

function ActualBlocks({ actual: a, part, grid }: { actual: Actual; part?: [number, number]; grid: GridGeometry }) {
  const activities = useSync((s) => s.activities);
  const updateActual = useSync((s) => s.updateActual);
  const openEntry = useUI((s) => s.openEntry);
  const drag = useBlockDrag({
    start: a.start,
    end: a.end,
    grid,
    enabled: !part, // a stretch outside its to-do's plan: tap to edit the whole record
    // no cap at "now": you may stretch an actual you're still doing (or fix one) past the current time
    onCommit: (start, end) => updateActual(a.id, { start, end }),
    // dragged off the timeline: take this record out (its to-do, if any, is open again)
    onDropOutside: () => {
      const st = useSync.getState();
      const t = a.todoId ? st.todos.find((x) => x.id === a.todoId) : undefined;
      st.deleteActual(a.id);
      if (t && !t.fromActual && t.done) st.toggleTodo(t.id);
    },
  });
  const act = activityOf(activities, a.activityId);
  const color = a.color || act.color;
  const name = a.name || act.name;
  const fill = color; // confirmed: ground truth, full color
  if (isPoint(a.start, a.end)) {
    const at = drag.preview?.start ?? a.start;
    return (
      <PointPill
        at={at}
        grid={grid}
        dataAttr="actual"
        title={name}
        fill={fill}
        label={name}
        labelClass="text-fg/90"
        badge={drag.preview ? fmtTime(at) : undefined}
        onPointerDown={drag.onPointerDown}
        onClick={(ev) => {
          ev.stopPropagation();
          if (drag.justDragged.current || recentlyDragged()) return;
          openEntry({ mode: "edit", kind: "actual", id: a.id });
        }}
      />
    );
  }
  return (
    <>
      <Segments
        segs={segmentsOf(part?.[0] ?? a.start, part?.[1] ?? a.end, grid.dayStart, grid.rows)}
        laneKey={`a:${a.id}${part ? `:${part[0]}` : ""}`}
        dataAttr="actual"
        {...openEdges(part?.[0] ?? a.start, part?.[1] ?? a.end, grid)}
        title={name}
        className="cursor-pointer touch-pan-y [-webkit-touch-callout:none]"
        look={{ fill, z: 20, hidden: drag.dragging }}
        label={name}
        flowText={name}
        labelClass="text-white"
        onPointerDown={drag.onPointerDown}
        handles={!part}
        onClick={(ev) => {
          ev.stopPropagation();
          if (drag.justDragged.current || recentlyDragged()) return;
          openEntry({ mode: "edit", kind: "actual", id: a.id });
        }}
      />
      {drag.preview && !drag.overTasks && (
        <Segments
          segs={segmentsOf(drag.preview.start, drag.preview.end, grid.dayStart, grid.rows)}
          className="pointer-events-none"
          look={{ fill, stroke: "var(--fg)", z: 40, shadow: true }}
          label={name}
          labelClass="text-fg"
          badge={`${fmtTime(drag.preview.start)} – ${fmtTime(drag.preview.end)}`}
          dataAttr="drag-preview"
          {...openEdges(drag.preview.start, drag.preview.end, grid)}
        />
      )}
    </>
  );
}

/**
 * Below the grid (scroll down): the day's Ote / Attainment and actual vs. planned per activity.
 * Rates show "—" until the day is over — a day's score is final once it closes.
 */
function DaySummary({ dayStart, dayEnd, now }: { dayStart: number; dayEnd: number; now: number }) {
  const { plans, actuals, activities } = useSync();
  const occs = expandPlans(plans, dayStart, dayEnd).filter((o) => !o.plan.allDay && o.start >= dayStart && o.start < dayEnd);
  const total = fulfil(occs, actuals);
  const over = now >= dayEnd;
  const ids = new Set<string>(occs.map((o) => o.plan.activityId));
  for (const a of actuals) if (a.end > dayStart && a.start < dayEnd) ids.add(a.activityId);
  const rows = [...ids]
    .map((id) => ({ id, act: activityOf(activities, id), stat: fulfil(occs.filter((o) => o.plan.activityId === id), actuals), actual: actualTime(actuals, dayStart, dayEnd, id) }))
    .sort((a, b) => a.act.order - b.act.order);
  return (
    <section data-day-summary className="mt-8 border-t border-fg/[0.09] pt-8">
      <div className="flex justify-center gap-12">
        <BigStat label="On time" value={over ? syncRate(total) : null} />
        <BigStat label="Attainment" value={over ? attainmentRate(total) : null} />
      </div>
      <div className="mt-8">
        <ActivityBar name="All" stat={total} actual={actualTime(actuals, dayStart, dayEnd)} />
        <div className="mt-2 flex gap-3 text-[10px] text-fg/50">
          <Legend color="var(--matched)" label="Matched plan" />
          <Legend color="var(--elsewhere)" label="At another time" />
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-5">
        {rows.map((r) => (
          <ActivityBar key={r.id} name={r.act.name} color={r.act.color} stat={r.stat} actual={r.actual} />
        ))}
      </div>
    </section>
  );
}

/**
 * A to-do with only a start time (a "1-minute" item, e.g. a connector's task scheduled without an end)
 * shown at its minute in the Plan column. Tap to edit; done ones fade.
 */
/** A to-do with a start and end: a block like a plan (faint, thin outline) led by its checkbox. */
function TodoBlock({ todo, start, end, grid }: { todo: Todo; start: number; end: number; grid: GridGeometry }) {
  const openEntry = useUI((s) => s.openEntry);
  const toggleTodo = useSync((s) => s.toggleTodo);
  const updateTodo = useSync((s) => s.updateTodo);
  const label = branchLabel(todo, useSync.getState().todos);
  // move it, or pull either end (< >) — like a plan, in 5-minute steps; it stays a to-do
  const drag = useBlockDrag({
    start,
    end,
    grid,
    enabled: true,
    onCommit: (s, e) => {
      const d = new Date(s);
      d.setHours(0, 0, 0, 0);
      updateTodo(todo.id, { date: d.getTime(), time: Math.round((s - d.getTime()) / MIN), duration: Math.max(1, Math.round((e - s) / MIN)) });
    },
  });
  const title = (
    <span className={cx(todo.done && "line-through")}>
      {todo.name}
      {label && <span className="text-fg/50"> {label}</span>}
    </span>
  );
  return (
    <>
      <Segments
        segs={segmentsOf(start, end, grid.dayStart, grid.rows)}
        laneKey={`todo:${todo.id}`}
        dataAttr="todo-block"
        {...openEdges(start, end, grid)}
        title={todo.name}
        className={cx("cursor-pointer touch-pan-y [-webkit-touch-callout:none]", todo.done && "opacity-45")}
        look={{ fill: faint(todo.color), stroke: todo.color, strokeWidth: 1, z: 25, hidden: drag.dragging, className: todo.done ? "opacity-45" : undefined }}
        label={title}
        flowText={label ? `${todo.name} ${label}` : todo.name}
        flowLead={18}
        labelClass={cx("text-fg/85", todo.done && "line-through")}
        onPointerDown={drag.onPointerDown}
        handles
        onClick={(e) => {
          e.stopPropagation();
          if (drag.justDragged.current || recentlyDragged()) return;
          openEntry({ mode: "edit", kind: "todo", id: todo.id });
        }}
        extra={
          <button
            aria-label={todo.done ? "Mark not done" : "Mark done"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleTodo(todo.id);
            }}
            className="relative z-10 order-first mr-1 flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border"
            style={{ borderColor: todo.color, background: todo.done ? todo.color : "transparent" }}
          >
            {todo.done && <CheckIcon size={8} className="text-bg" />}
          </button>
        }
      />
      {drag.preview && (
        <Segments
          segs={segmentsOf(drag.preview.start, drag.preview.end, grid.dayStart, grid.rows)}
          className="pointer-events-none"
          look={{ fill: faint(todo.color), stroke: "var(--fg)", z: 40, shadow: true }}
          label={title}
          labelClass="text-fg/90"
          badge={`${fmtTime(drag.preview.start)} – ${fmtTime(drag.preview.end)}`}
          dataAttr="drag-preview"
          {...openEdges(drag.preview.start, drag.preview.end, grid)}
        />
      )}
    </>
  );
}

/** Turn a plan occurrence into a to-do at the same date/time and length (one step to undo). */
function planToTodo(occ: PlanOccurrence) {
  const s = useSync.getState();
  const d = new Date(occ.start);
  d.setHours(0, 0, 0, 0);
  s.addTodo({
    name: occ.plan.name || activityOf(s.activities, occ.plan.activityId).name,
    activityId: occ.plan.activityId,
    color: occ.plan.color,
    date: d.getTime(),
    time: Math.round((occ.start - d.getTime()) / MIN),
    duration: Math.max(1, Math.round((occ.end - occ.start) / MIN)),
  });
  if (occ.plan.repeat === "never") s.deletePlan(occ.plan.id);
  else s.skipOccurrence(occ.plan.id, occ.start);
}

/** 1–2 minute items are points in time: drawn as a pill (like timed to-dos) so they're visible and tappable. */
const isPoint = (start: number, end: number) => end - start <= 2 * MIN;

function PointPill({
  at,
  grid,
  dataAttr,
  title,
  fill,
  stroke,
  dashed,
  label,
  labelClass = "text-fg/85",
  badge,
  onClick,
  onPointerDown,
}: {
  at: number;
  grid: GridGeometry;
  dataAttr: string;
  title: string;
  fill: string;
  stroke?: string;
  dashed?: boolean;
  label: string;
  labelClass?: string;
  badge?: string;
  onClick: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  // a point in time is a flag planted exactly there: the pole at that minute, the flag (and the
  // name) waving to its right
  const row = Math.floor((at - grid.dayStart) / HOUR);
  if (row < 0 || row >= grid.rows) return null;
  const frac = ((at - grid.dayStart) % HOUR) / HOUR;
  const flagColor = stroke ?? fill;
  // near the end of the row there's no room to the right: the flag (and name) fly to the left
  const flip = frac > 0.6;
  return (
    <div
      {...{ [`data-${dataAttr}`]: "1" }}
      data-point
      data-flip={flip ? "" : undefined}
      title={`${title} · ${fmtTime(at)}`}
      onClick={onClick}
      onPointerDown={onPointerDown ?? ((e) => e.stopPropagation())}
      className={cx("absolute z-30 flex cursor-pointer touch-pan-y items-start [-webkit-touch-callout:none]", flip && "flex-row-reverse")}
      style={{
        top: row * ROW_H + 2,
        height: ROW_H - 4,
        ...(flip
          ? { right: `calc(${(1 - frac) * 100}% - 1px)`, maxWidth: `calc(${frac * 100}% + 1px)` }
          : { left: `calc(${frac * 100}% - 1px)`, maxWidth: `calc(${(1 - frac) * 100}% + 1px)` }),
      }}
    >
      <svg
        width="16"
        height={ROW_H - 4}
        viewBox={`0 0 16 ${ROW_H - 4}`}
        className="shrink-0 overflow-visible"
        style={flip ? { transform: "scaleX(-1)" } : undefined}
        aria-hidden
      >
        {/* pole */}
        <line x1="1" y1="0.5" x2="1" y2={ROW_H - 4} stroke={flagColor} strokeWidth="1.8" strokeLinecap="round" />
        {/* flag */}
        <path
          className="flag-wave"
          d="M1.8 1.2 C5.5 -0.4 8.5 3 13.5 1.4 L13.5 9.6 C8.5 11.2 5.5 7.8 1.8 9.4 Z"
          style={{ fill: dashed ? fill : flagColor, stroke: flagColor }}
          strokeWidth="1.1"
          strokeDasharray={dashed ? "2 1.6" : undefined}
          strokeLinejoin="round"
        />
      </svg>
      <span className={cx("pointer-events-none mt-[1px] min-w-0 truncate text-[10.5px] font-medium leading-[12px]", flip ? "-mr-0.5 text-right" : "-ml-0.5", labelClass)}>{label}</span>
      {badge && (
        <span
          className={cx("pointer-events-none absolute -top-5 whitespace-nowrap rounded-full bg-fg px-2 py-[2px] text-[11px] font-semibold text-bg tabular shadow-lg", flip ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2")}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function TimedTodo({ todo, row, frac }: { todo: Todo; row: number; frac: number }) {
  const openEntry = useUI((s) => s.openEntry);
  const toggleTodo = useSync((s) => s.toggleTodo);
  const width = 1 / 2; // three 10-minute cells, so the title is readable
  const label = branchLabel(todo, useSync.getState().todos);
  return (
    <div
      data-todo={todo.id}
      title={todo.name}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (recentlyDragged()) return;
        openEntry({ mode: "edit", kind: "todo", id: todo.id });
      }}
      className={cx(
        "absolute z-30 flex cursor-pointer items-center gap-1 overflow-hidden rounded-full border border-fg/40 bg-block pl-[3px] pr-1.5 text-[10.5px]",
        todo.done && "opacity-45",
      )}
      style={{ top: row * ROW_H + ROW_H / 2 - 9, height: 18, left: `calc(${Math.min(frac, 1 - width) * 100}% + 1px)`, width: `calc(${width * 100}% - 2px)` }}
    >
      <button
        aria-label={todo.done ? "Mark not done" : "Mark done"}
        onClick={(e) => {
          e.stopPropagation();
          toggleTodo(todo.id);
        }}
        className="flex h-[12px] w-[12px] shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: todo.color, background: todo.done ? todo.color : "transparent" }}
      >
        {todo.done && <CheckIcon size={8} className="text-bg" />}
      </button>
      <span className={cx("truncate", todo.done && "line-through")}>
        {todo.name}
        {label && <span className="text-fg/50"> {label}</span>}
      </span>
    </div>
  );
}

/**
 * Tapping a dashed tentative actual: record it exactly as planned (plan = actual), adjust the times
 * first, or mark it as not done. Until then it stays dashed and faint.
 */
function ConfirmActual({
  target,
  now,
  onClose,
  onAdjust,
}: {
  target: RecordTarget;
  now: number;
  onClose: () => void;
  onAdjust: (a: Adjusting) => void;
}) {
  const { activities, dismissOccurrence, skipEvent } = useSync();
  const isPlan = target.kind === "plan";
  const { start, end: planEnd, name, color } = describe(target, activities);
  // started by the real clock (a resume is stored to the minute; 5-minute rounding of "now" could
  // still read as "not started" right after it)
  const started = start < now;
  const cap = Math.max(roundToStep(now), start + MIN);
  const end = Math.min(planEnd, cap); // actuals stop at now
  const ongoing = planEnd > now;

  function asPlanned() {
    recordTarget(target, start, end);
    onClose();
  }
  // pause: what's done so far becomes an actual; the rest of the plan stays dashed from now
  const run: Run | undefined =
    target.kind === "plan"
      ? target.occ.plan.runs?.[String(target.occ.start)]
      : target.kind === "todo"
        ? target.todo.run
        : target.kind === "rest"
          ? { from: target.actual.rest!.from, end: target.actual.rest!.end, paused: target.actual.rest!.paused }
          : undefined;
  const paused = !!run?.paused;
  const canPause = target.kind !== "event" && !paused && started && ongoing;
  const setRun = (r: Run) => setRunOf(target, r);
  function pause() {
    const at = Math.round(now / MIN) * MIN;
    if (at - start >= MIN) {
      const st = useSync.getState();
      if (target.kind === "plan") {
        const p = target.occ.plan;
        st.addActual({ name: p.name, activityId: p.activityId, color: p.color, start, end: at, planKey: target.occ.key });
      } else if (target.kind === "todo") {
        st.addActual({ name: target.todo.name, activityId: target.todo.activityId, color: target.todo.color, start, end: at, todoId: target.todo.id });
      } else if (target.kind === "rest") {
        const a = target.actual;
        st.addActual({ name: a.name, activityId: a.activityId, color: a.color, start, end: at, planKey: a.planKey, todoId: a.todoId });
      }
    }
    setRun({ from: at, end: run?.end, paused: true });
    onClose();
  }
  function resume() {
    setRun({ from: Math.round(now / MIN) * MIN, end: run?.end, paused: false });
    onClose();
  }
  function adjust() {
    onClose();
    onAdjust({ target, name, color, start, end: started ? end : planEnd });
  }

  return (
    <div data-confirm className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 px-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:items-center" onClick={onClose}>
      <div className="animate-fade w-full max-w-[400px] rounded-[20px] bg-surface p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: color }} />
          <p className="min-w-0 flex-1 truncate text-[16px] font-semibold">{name}</p>
          {(canPause || paused) && (
            <button
              aria-label={paused ? "Resume" : "Pause"}
              title={paused ? "Resume from now" : "Pause — record so far, keep the rest dashed"}
              onClick={paused ? resume : pause}
              className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-fg/[0.08] text-fg/80 hover:bg-fg/[0.14]"
            >
              {paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
            </button>
          )}
        </div>
        <p className="mt-1 text-[13px] text-fg/55 tabular">
          {fmtTime(start)} – {fmtTime(planEnd)}
          {started && ongoing && <> · in progress, records until {fmtTime(end)}</>}
        </p>
        {target.kind === "event" && <EventCalendar calendarId={target.event.calendarId} color={target.event.color} />}
        {paused && (
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={() => {
                // stop here: what was recorded stands, the rest is dropped
                if (target.kind === "rest") useSync.getState().updateActual(target.actual.id, { rest: undefined });
                else if (run) setRun({ ...run, done: true });
                if (target.kind === "todo" && !target.todo.done) useSync.getState().toggleTodo(target.todo.id);
                onClose();
              }}
              className="h-[40px] rounded-[12px] bg-surface-2 text-[14px] font-medium"
            >
              Finish here
            </button>
            <p className="px-1 text-[12px] text-fg/50">Paused at {fmtTime(start)} — the rest stays planned until you resume.</p>
          </div>
        )}
        {!paused && !started ? (
          <p className="mt-3 text-[13px] text-fg/60">This hasn&apos;t started yet. Confirm it once it&apos;s underway.</p>
        ) : !paused && (
          <div className="mt-4 flex flex-col gap-2">

            <button onClick={asPlanned} className="h-[46px] rounded-[12px] bg-fg/70 text-[15px] font-semibold text-bg">
              Done as planned
            </button>
            <button onClick={adjust} className="h-[46px] rounded-[12px] bg-surface-2 text-[15px] font-semibold">
              Adjust time…
            </button>
            {(isPlan || target.kind === "event") && (
              <button
                onClick={() => {
                  if (target.kind === "plan") dismissOccurrence(target.occ.plan.id, target.occ.start);
                  else if (target.kind === "event") skipEvent(target.event.id);
                  onClose();
                }}
                className="h-[40px] rounded-[12px] text-[14px] text-danger-soft"
              >
                Didn&apos;t do it
              </button>
            )}
          </div>
        )}
        <button onClick={onClose} className="mt-2 h-[40px] w-full rounded-[12px] text-[14px] text-fg/60">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The running timer / pomodoro block: name what you're working on (the record and its to-do get it). */
function RenameTimer({ onClose }: { onClose: () => void }) {
  const timer = useSync((s) => s.timer);
  const activities = useSync((s) => s.activities);
  const [name, setName] = useState(() => timer?.name || "");
  if (!timer) return null;
  const save = () => {
    const t = useSync.getState().timer;
    if (t) useSync.setState({ timer: { ...t, name: name.trim() } });
    onClose();
  };
  return (
    <div data-rename-timer className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 px-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:items-center" onClick={onClose}>
      <div className="animate-fade w-full max-w-[400px] rounded-[20px] bg-surface p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-[13px] text-fg/55">
          {timer.targetEnd ? "Pomodoro" : "Timer"} · since {fmtTime(timer.start)} · {activityOf(activities, timer.activityId).name}
        </p>
        <input
          autoFocus
          aria-label="Session name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
          placeholder="What are you working on?"
          className="mt-2 h-[44px] w-full rounded-[12px] bg-surface-2 px-3 text-[15px] outline-none placeholder:text-fg/35"
        />
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="h-[42px] flex-1 rounded-[12px] text-[14px] text-fg/60">
            Cancel
          </button>
          <button onClick={save} className="h-[42px] flex-1 rounded-[12px] bg-link text-[15px] font-semibold text-white">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

interface Adjusting {
  target: RecordTarget;
  name: string;
  color: string;
  start: number;
  end: number;
}

const isAdjusted = (it: Item, a: Adjusting) =>
  (it.kind === "pending" && a.target.kind === "plan" && it.occ.key === a.target.occ.key) ||
  (it.kind === "pending-event" && a.target.kind === "event" && it.event.id === a.target.event.id) ||
  (it.kind === "pending-todo" && a.target.kind === "todo" && it.todo.id === a.target.todo.id) ||
  (it.kind === "pending-rest" && a.target.kind === "rest" && it.actual.id === a.target.actual.id);

/** A tentative point in time (a 1-minute plan): a dashed flag — tap to confirm, drag to move it. */
function PendingPoint({
  target,
  name,
  color,
  start,
  end,
  grid,
  onClick,
}: {
  target: RecordTarget;
  name: string;
  color: string;
  start: number;
  end: number;
  grid: GridGeometry;
  onClick: (e: React.MouseEvent) => void;
}) {
  const adjust = useContext(AdjustCtx);
  const drag = useBlockDrag({ start, end, grid, enabled: true, onCommit: (s, e) => adjust({ target, name, color, start: s, end: e }) });
  const at = drag.preview?.start ?? start;
  return (
    <PointPill
      at={at}
      grid={grid}
      dataAttr="pending"
      title={name}
      fill={tentative(color)}
      stroke={color}
      dashed
      label={name}
      badge={drag.preview ? fmtTime(at) : undefined}
      onPointerDown={drag.onPointerDown}
      onClick={(ev) => {
        if (drag.justDragged.current) {
          ev.stopPropagation();
          return;
        }
        onClick(ev);
      }}
    />
  );
}

/**
 * A dashed tentative actual: tap to confirm / adjust; or drag it (or pull an end) straight away —
 * that opens adjusting at the dragged times, to save as the actual.
 */
function PendingBlocks({
  segs,
  laneKey,
  target,
  name,
  color,
  start,
  end,
  grid,
  onClick,
}: {
  segs: Segment[];
  laneKey: string;
  target: RecordTarget;
  name: string;
  color: string;
  start: number;
  end: number;
  grid: GridGeometry;
  onClick: (e: React.MouseEvent) => void;
}) {
  const adjust = useContext(AdjustCtx);
  const drag = useBlockDrag({ start, end, grid, enabled: true, onCommit: (s, e) => adjust({ target, name, color, start: s, end: e }) });
  return (
    <>
      <Segments
        segs={segs}
        laneKey={laneKey}
        dataAttr="pending"
        {...openEdges(start, end, grid)}
        title={name}
        className="cursor-pointer touch-pan-y [-webkit-touch-callout:none]"
        look={{ fill: tentative(color), stroke: color, dashed: true, z: 20, hidden: drag.dragging }}
        label={name}
        flowText={name}
        labelClass="text-fg/90"
        onPointerDown={drag.onPointerDown}
        handles
        onClick={(ev) => {
          if (drag.justDragged.current) {
            ev.stopPropagation();
            return;
          }
          onClick(ev);
        }}
      />
      {drag.preview && (
        <Segments
          segs={segmentsOf(drag.preview.start, drag.preview.end, grid.dayStart, grid.rows)}
          className="pointer-events-none"
          look={{ fill: color, stroke: "var(--fg)", z: 40, shadow: true }}
          label={name}
          labelClass="text-white"
          badge={`${fmtTime(drag.preview.start)} – ${fmtTime(drag.preview.end)}`}
          dataAttr="drag-preview"
          {...openEdges(drag.preview.start, drag.preview.end, grid)}
        />
      )}
    </>
  );
}

/** The block being adjusted: bright, above the dim layer, drag to move / handles to resize (5 min). */
function AdjustBlock({ adj, grid, onChange }: { adj: Adjusting; grid: GridGeometry; onChange: (start: number, end: number) => void }) {
  const drag = useBlockDrag({ start: adj.start, end: adj.end, grid, enabled: true, onCommit: onChange });
  const r = drag.preview ?? adj;
  return (
    <Segments
      segs={segmentsOf(r.start, r.end, grid.dayStart, grid.rows)}
      dataAttr="adjusting"
      {...openEdges(r.start, r.end, grid)}
      title={adj.name}
      className="cursor-grab touch-none active:cursor-grabbing"
      look={{ fill: adj.color, stroke: "var(--fg)", strokeWidth: 2, z: 55, shadow: true }}
      label={adj.name}
      labelClass="text-white font-medium"
      badge={`${fmtTime(r.start)} – ${fmtTime(r.end)}`}
      onPointerDown={drag.onPointerDown}
      handles
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Bottom bar while adjusting: save the dragged times as the actual, or fine-tune in the sheet. */
function AdjustBar({ adj, onDone }: { adj: Adjusting; onDone: () => void }) {
  const openEntry = useUI((s) => s.openEntry);
  const t = adj.target;
  const save = () => {
    recordTarget(t, adj.start, adj.end);
    onDone();
  };
  // Enter (or a tap anywhere outside the lifted block and this bar) applies; Escape cancels
  const saveRef = useRef(save);
  const doneRef = useRef(onDone);
  useEffect(() => {
    saveRef.current = save;
    doneRef.current = onDone;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        saveRef.current();
      } else if (e.key === "Escape") doneRef.current();
    };
    const away = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-adjusting], [data-adjust-bar]")) return;
      e.stopPropagation();
      e.preventDefault();
      // that tap only closes adjusting: swallow the click it would turn into
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 500);
      saveRef.current();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", away, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", away, true);
    };
  }, []);
  const details = () => {
    onDone();
    if (t.kind === "plan") openEntry({ mode: "new", kind: "actual", fromPlan: t.occ.key, start: adj.start, end: adj.end });
    else if (t.kind === "event") openEntry({ mode: "new", kind: "actual", fromEvent: { ...t.event, start: adj.start, end: adj.end } });
    else openEntry({ mode: "new", kind: "actual", start: adj.start, end: adj.end });
  };
  return (
    // inside the timeline pane (not over the pomodoro / other panes), above the tab bar
    <div data-adjust-bar className="absolute inset-x-0 bottom-[calc(var(--tabbar-h)+8px)] z-[60] flex justify-center px-3">
      <div className="animate-fade flex w-full max-w-[420px] items-center gap-2 rounded-[16px] border border-fg/10 bg-surface p-2.5 shadow-2xl">
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[13.5px] font-semibold">{adj.name}</p>
          <p className="text-[12px] text-fg/55 tabular">
            {fmtTime(adj.start)} – {fmtTime(adj.end)} · drag to adjust
          </p>
        </div>
        <button aria-label="Cancel" title="Cancel (Esc)" onClick={onDone} className="flex h-[36px] w-[30px] items-center justify-center rounded-[10px] text-fg/50 hover:bg-fg/[0.06]">
          <XIcon size={13} />
        </button>
        {t.kind !== "event" && (
          <button
            onClick={() => {
              // keep it tentative (dashed), just at these times
              setRunOf(t, { from: adj.start, end: adj.end, paused: false });
              onDone();
            }}
            title="Move the dashed block without confirming it"
            className="h-[36px] rounded-[10px] bg-surface-2 px-2.5 text-[13px] font-medium"
          >
            Move only
          </button>
        )}
        <button onClick={details} className="h-[36px] rounded-[10px] bg-surface-2 px-2.5 text-[13px] font-medium">
          Details…
        </button>
        <button onClick={save} className="h-[36px] rounded-[10px] bg-fg/80 px-3.5 text-[13px] font-semibold text-bg">
          Save
        </button>
      </div>
    </div>
  );
}

function EventCalendar({ calendarId, color }: { calendarId: string; color?: string }) {
  const label = useCalendarLabel(calendarId);
  if (!label) return null;
  return (
    <p data-event-calendar className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-fg/45">
      <SmallCalIcon size={11} className="shrink-0" style={{ color }} />
      <span className="truncate">{label}</span>
    </p>
  );
}
