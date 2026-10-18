"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarEvent, PlanOccurrence, Todo } from "@/lib/types";
import { activityOf, branchLabel, openAndDone, useSync, withBranchesUnderMain } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { useCalendarEvents, useNow } from "@/lib/hooks";
import { expandPlans } from "@/lib/plans";
import {
  WEEKDAY_LETTER,
  WEEKDAY_LONG,
  addDays,
  addMonths,
  fmtMinutesOfDay,
  fmtTime,
  isSameDay,
  logicalDate,
  logicalDayRange,
  startOfMonth,
  startOfWeek,
} from "@/lib/time";
import { BranchIcon, CheckIcon, ChevronLeft, ChevronRight, FilterIcon, PlusIcon, SearchIcon, SmallCalIcon } from "../icons";
import { Segmented, cx } from "../ui";
import { eventTint } from "../today/Timeline";
import { useCalendarLabel } from "@/lib/writable-calendars";
import { eventIn } from "@/lib/event-twins";
import { DiaryBox } from "../diary/DiaryBox";
import { MissedRow } from "../MissedRow";

type Entry =
  | { kind: "plan"; occ: PlanOccurrence; start: number; end: number; allDay: boolean; title: string; color: string }
  | { kind: "event"; event: CalendarEvent; start: number; end: number; allDay: boolean; title: string; color: string };

const HIDDEN_KEY = "sync-calendar-hidden-activities";

function loadHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function CalendarView() {
  const router = useRouter();
  const now = useNow(60_000);
  const { plans, todos, activities, settings, toggleTodo } = useSync();
  const date = useUI((s) => s.date);
  const setDate = useUI((s) => s.setDate);
  const openEntry = useUI((s) => s.openEntry);
  const [view, setView] = useState<"week" | "month">("week");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  // the To-dos cell can be "selected" like a day: the list below then shows the to-dos
  const [todosPicked, setTodosPicked] = useState(false);
  const pickDay = (day: number) => {
    setTodosPicked(false);
    setDate(day);
  };
  const today = logicalDate(now, settings.dayStart);

  const rangeStart = view === "week" ? startOfWeek(date, settings.weekStartsOn) : startOfWeek(startOfMonth(date), settings.weekStartsOn);
  const days = view === "week" ? 7 : weeksInMonthGrid(date, settings.weekStartsOn) * 7;
  const rangeEnd = addDays(rangeStart, days);
  const [qStart, qEnd] = [logicalDayRange(rangeStart, settings.dayStart)[0], logicalDayRange(addDays(rangeEnd, -1), settings.dayStart)[1]];
  const { events } = useCalendarEvents(qStart, qEnd);

  const hiddenSet = new Set(hidden);
  const entries: Entry[] = (() => {
    const occ = expandPlans(plans, qStart, qEnd)
      .filter((o) => !hiddenSet.has(o.plan.activityId))
      .map<Entry>((o) => ({
        kind: "plan",
        occ: o,
        start: o.start,
        end: o.end,
        allDay: o.plan.allDay,
        title: o.plan.name || activityOf(activities, o.plan.activityId).name,
        color: o.plan.color,
      }));
    const used = new Set(plans.map((p) => p.sourceEventId).filter(Boolean));
    const evs = events
      .filter((e) => !eventIn(used, e))
      .map<Entry>((e) => ({ kind: "event", event: e, start: e.start, end: e.end, allDay: e.allDay, title: e.title, color: e.color }));
    return [...occ, ...evs].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
  })();

  const entriesOn = (d: number) => {
    // timed items belong to the logical day they start in (an overnight sleep shows once)
    return entries.filter((x) => (x.allDay ? x.start < addDays(d, 1) && x.end > d : logicalDate(x.start, settings.dayStart) === d));
  };

  const q = query.trim().toLowerCase();
  const results = (() => {
    if (!q) return [];
    const acts = activities.filter((a) => a.name.toLowerCase().includes(q)).map((a) => a.id);
    return entries.filter((x) => {
      if (x.title.toLowerCase().includes(q)) return true;
      if (x.kind === "plan") return acts.includes(x.occ.plan.activityId) || (x.occ.plan.place ?? "").toLowerCase().includes(q);
      return (x.event.location ?? "").toLowerCase().includes(q) || (x.event.notes ?? "").toLowerCase().includes(q);
    });
  })();

  // the To-dos cell holds only undated to-dos; dated ones belong to their day
  const undatedTodos = withBranchesUnderMain(openAndDone(todos, (t) => t.date === undefined).open.sort((a, b) => a.createdAt - b.createdAt));
  const datedTodos = withBranchesUnderMain(
    openAndDone(todos, (t) => t.date !== undefined).open.sort((a, b) => (a.date ?? 0) - (b.date ?? 0) || (a.time ?? -1) - (b.time ?? -1) || a.createdAt - b.createdAt),
  );
  const todosOn = (day: number) => {
    const g = openAndDone(todos, (t) => t.date !== undefined && isSameDay(t.date, day));
    const byTime = (a: Todo, b: Todo) => (a.time ?? -1) - (b.time ?? -1);
    // undated to-dos count as done on the day they were finished
    const [ds, de] = logicalDayRange(day, settings.dayStart);
    const doneUndated = todos.filter((t) => t.date === undefined && t.done && t.doneAt !== undefined && t.doneAt >= ds && t.doneAt < de);
    return [...withBranchesUnderMain(g.open.sort(byTime)), ...withBranchesUnderMain([...g.done, ...doneUndated].sort(byTime))];
  };
  const editTodo = (t: Todo) => openEntry({ mode: "edit", kind: "todo", id: t.id });
  const missedOn = (day: number) => todos.filter((t) => t.missed?.some((m) => isSameDay(m, day)));

  function nav(dir: number) {
    setDate(view === "week" ? addDays(date, 7 * dir) : addMonths(date, dir));
  }

  function openItem(x: Entry, d: number) {
    if (x.kind === "plan") openEntry({ mode: "edit", kind: "plan", id: x.occ.plan.id, occurrenceStart: x.occ.start });
    else openEntry({ mode: "new", kind: "plan", fromEvent: x.event, date: d });
  }

  const ws = startOfWeek(date, settings.weekStartsOn);
  const d = new Date(date);
  const navLabel =
    view === "week"
      ? `${new Date(ws).getMonth() + 1}/${new Date(ws).getDate()}–${new Date(addDays(ws, 6)).getMonth() === new Date(ws).getMonth() ? "" : `${new Date(addDays(ws, 6)).getMonth() + 1}/`}${new Date(addDays(ws, 6)).getDate()}, ${new Date(addDays(ws, 6)).getFullYear()}`
      : `${d.getMonth() + 1}/${d.getFullYear()}`;

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-[calc(var(--tabbar-h)+48px)] pt-[max(12px,env(safe-area-inset-top))]">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-2">
        {date !== today && (
          <button
            aria-label="Go to today"
            onClick={() => {
              setTodosPicked(false);
              setDate(today);
            }}
            className="absolute left-4 rounded-full bg-fg/[0.08] px-2.5 py-1 text-[12.5px] font-semibold text-fg/80 hover:bg-fg/[0.14]"
          >
            Today
          </button>
        )}
        <h1 className="text-[17px] font-semibold">Calendar</h1>
        <button
          aria-label="Filter activities"
          onClick={() => setFilterOpen((v) => !v)}
          className="absolute right-4 flex h-[36px] w-[36px] items-center justify-center rounded-full border border-fg/10 bg-fg/[0.06]"
        >
          <FilterIcon size={20} />
        </button>
        {filterOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
            <div className="animate-fade absolute right-3 top-[44px] z-40 w-[190px] overflow-hidden rounded-[16px] border border-fg/10 bg-surface-2/95 py-1.5 shadow-2xl backdrop-blur-xl">
              <p className="px-3.5 pb-1 pt-1 text-[12px] text-fg/45">Activities shown</p>
              {activities.map((a) => {
                const shown = !hiddenSet.has(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      const next = shown ? [...hidden, a.id] : hidden.filter((x) => x !== a.id);
                      setHidden(next);
                      try {
                        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
                      } catch {}
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[15px]"
                  >
                    <span className="w-4">{shown && <CheckIcon size={16} />}</span>
                    <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                    {a.name}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </header>

      <div className="px-4">
        <label className="flex h-[42px] items-center gap-2 rounded-full border border-fg/10 bg-surface px-3.5">
          <SearchIcon size={17} className="text-fg/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — names, activities, notes, events"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg/40"
          />
        </label>
      </div>

      {q ? (
        <div className="mt-4 px-4">
          {results.length === 0 && <p className="py-10 text-center text-[14px] text-fg/45">No results in this {view}.</p>}
          {results.map((x) => (
            <DayRow key={keyOf(x)} x={x} onClick={() => openItem(x, logicalDate(x.start, settings.dayStart))} showDate />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-4 px-4">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
              ]}
            />
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <button aria-label="Previous" onClick={() => nav(-1)} className="p-1 text-fg/90">
              <ChevronLeft size={18} />
            </button>
            <span className="text-[15px] font-medium tabular">{navLabel}</span>
            <button aria-label="Next" onClick={() => nav(1)} className="p-1 text-fg/90">
              <ChevronRight size={18} />
            </button>
          </div>

          {view === "week" ? (
            <div className="grid grid-cols-4 gap-[5px] border-t border-fg/[0.08] px-2 pt-2">
              <TodoCell todos={undatedTodos} selected={todosPicked} onToggle={toggleTodo} onSelect={() => setTodosPicked(true)} />
              {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((day) => (
                <DayCell
                  key={day}
                  day={day}
                  selected={isSameDay(day, date)}
                  isToday={isSameDay(day, today)}
                  items={entriesOn(day)}
                  onClick={() => pickDay(day)}
                  tall
                />
              ))}
            </div>
          ) : (
            <div className="border-t border-fg/[0.08] px-1.5">
              <div className="grid grid-cols-7 py-2 text-center text-[11px] text-fg/45">
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i}>{WEEKDAY_LETTER[(settings.weekStartsOn + i) % 7]}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-[3px]">
                {Array.from({ length: days }, (_, i) => addDays(rangeStart, i)).map((day) => (
                  <DayCell
                    key={day}
                    day={day}
                    selected={isSameDay(day, date)}
                    isToday={isSameDay(day, today)}
                    outside={new Date(day).getMonth() !== d.getMonth()}
                    items={entriesOn(day)}
                    onClick={() => pickDay(day)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Selected: the To-dos cell (undated first, then dated) or a day (its items, then its to-dos) */}
          {todosPicked && view === "week" ? (
            <div data-todo-list className="mt-5 border-t border-fg/[0.08] px-4 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[17px] font-semibold">To-dos</span>
                <button aria-label="Add to-do" onClick={() => openEntry({ mode: "new", kind: "todo" })} className="p-1">
                  <PlusIcon size={20} />
                </button>
              </div>
              {undatedTodos.length === 0 && datedTodos.length === 0 && <p className="py-6 text-center text-[14px] text-fg/40">No open to-dos.</p>}
              {undatedTodos.length > 0 && <p className="pb-1 pt-1 text-[12px] font-medium text-fg/45">No date</p>}
              {undatedTodos.map((t) => (
                <TodoRow key={t.id} t={t} onToggle={toggleTodo} onOpen={editTodo} />
              ))}
              {datedTodos.length > 0 && <p className="pb-1 pt-3 text-[12px] font-medium text-fg/45">Scheduled</p>}
              {datedTodos.map((t) => (
                <TodoRow key={t.id} t={t} onToggle={toggleTodo} onOpen={editTodo} showDate />
              ))}
            </div>
          ) : (
          <div className="mt-5 border-t border-fg/[0.08] px-4 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={() => {
                  setDate(date);
                  router.push("/");
                }}
                className="flex items-center gap-1 text-[17px] font-semibold"
              >
                {isSameDay(date, today) ? WEEKDAY_LONG[d.getDay()] : `${WEEKDAY_LONG[d.getDay()]}, ${d.getMonth() + 1}/${d.getDate()}`}
                <ChevronRight size={14} className="text-fg/45" />
              </button>
              <button
                aria-label="Add plan"
                onClick={() => {
                  const s = logicalDayRange(date, settings.dayStart)[0] + 4 * 3_600_000;
                  openEntry({ mode: "new", kind: "plan", start: s, end: s + 3_600_000 });
                }}
                className="p-1"
              >
                <PlusIcon size={20} />
              </button>
            </div>
            {entriesOn(date).length === 0 && <p className="py-6 text-center text-[14px] text-fg/40">Nothing planned.</p>}
            {entriesOn(date).map((x) => (
              <DayRow key={keyOf(x)} x={x} onClick={() => openItem(x, date)} />
            ))}
            {(todosOn(date).length > 0 || missedOn(date).length > 0) && (
              <div data-day-todos>
                <p className="pb-1 pt-3 text-[12px] font-medium text-fg/45">To-dos</p>
                {todosOn(date).map((t) => (
                  <TodoRow key={t.id} t={t} onToggle={toggleTodo} onOpen={editTodo} />
                ))}
                {missedOn(date).map((t) => (
                  <MissedRow key={`missed:${t.id}`} t={t} compact />
                ))}
              </div>
            )}
            <div className="pb-1 pt-4">
              <p className="pb-1.5 text-[12px] font-medium text-fg/45">Diary</p>
              <DiaryBox key={date} date={date} />
            </div>
          </div>
          )}
        </>
      )}
    </div>
  );
}

function keyOf(x: Entry) {
  return x.kind === "plan" ? x.occ.key : x.event.id;
}

function weeksInMonthGrid(date: number, weekStartsOn: number): number {
  const first = startOfMonth(date);
  const gridStart = startOfWeek(first, weekStartsOn);
  const next = addMonths(first, 1);
  return Math.ceil((next - gridStart) / (7 * 86_400_000) - 1e-9);
}

function Chip({ x, small }: { x: Entry; small?: boolean }) {
  if (x.kind === "event") {
    return (
      <div
        className={cx("flex shrink-0 items-center gap-[3px] truncate rounded-[3px] px-1 text-fg/85", small ? "text-[8.5px]" : "text-[9.5px]")}
        style={{ background: eventTint(x.color) }}
      >
        <SmallCalIcon size={8} className="shrink-0" style={{ color: x.color }} />
        <span className="truncate">{x.title}</span>
      </div>
    );
  }
  return (
    <div
      className={cx("shrink-0 truncate rounded-[3px] px-1", small ? "text-[8.5px]" : "text-[9.5px]")}
      style={{ background: `color-mix(in srgb, ${x.color} 45%, var(--surface-2))` }}
    >
      {x.title}
    </div>
  );
}

function DayCell({
  day,
  selected,
  isToday,
  outside,
  items,
  onClick,
  tall,
}: {
  day: number;
  selected: boolean;
  isToday: boolean;
  outside?: boolean;
  items: Entry[];
  onClick: () => void;
  tall?: boolean;
}) {
  const dt = new Date(day);
  const wd = dt.getDay();
  const max = tall ? 4 : 3;
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex flex-col gap-[2px] overflow-hidden rounded-[8px] p-1 text-left",
        tall ? "h-[118px] bg-surface" : "h-[74px] bg-surface-0",
        selected && "bg-surface-3",
        outside && "opacity-0 pointer-events-none",
      )}
    >
      <span className={cx("flex items-center gap-1 px-0.5 text-[12px] font-semibold tabular", tall ? "" : "justify-center")}>
        {tall && <span className="text-[10px] font-normal text-fg/55">{"SMTWTFS"[wd]}</span>}
        <span
          className={cx(
            isToday && "text-now",
            isToday && !selected && "underline decoration-2 underline-offset-2",
          )}
        >
          {dt.getDate()}
        </span>
      </span>
      {items.slice(0, max).map((x) => (
        <Chip key={keyOf(x)} x={x} small={!tall} />
      ))}
      {items.length > max && <span className="px-1 text-[9px] text-fg/50">+{items.length - max}</span>}
    </button>
  );
}

function TodoCell({
  todos,
  selected,
  onToggle,
  onSelect,
}: {
  todos: Todo[];
  selected: boolean;
  onToggle: (id: string) => void;
  onSelect: () => void;
}) {
  const all = useSync((st) => st.todos);
  return (
    <div
      data-todo-cell
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cx("flex h-[118px] cursor-pointer flex-col gap-1 overflow-hidden rounded-[8px] p-1.5", selected ? "bg-surface-3" : "bg-surface")}
    >
      <span className="text-[12px] font-semibold">To-dos</span>
      {todos.slice(0, 5).map((t) => (
        <div key={t.id} className="flex items-center gap-1 text-[9.5px]">
          <button
            aria-label="Done"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(t.id);
            }}
            className="h-[9px] w-[9px] shrink-0 rounded-full border border-fg/50"
          />
          <span className="truncate text-left">
            {t.name}
            {branchLabel(t, all) && <span className="text-fg/45"> {branchLabel(t, all)}</span>}
          </span>
        </div>
      ))}
      {todos.length > 5 && <span className="text-[9px] text-fg/50">+{todos.length - 5}</span>}
    </div>
  );
}

function TodoRow({ t, onToggle, onOpen, showDate }: { t: Todo; onToggle: (id: string) => void; onOpen: (t: Todo) => void; showDate?: boolean }) {
  const d = t.date !== undefined ? new Date(t.date) : null;
  const time =
    t.time !== undefined
      ? `${fmtMinutesOfDay(t.time)}${t.duration ? `–${fmtMinutesOfDay((t.time + t.duration) % 1440)}` : ""}`
      : "";
  const todos = useSync((st) => st.todos);
  const branchTodo = useSync((st) => st.branchTodo);
  const label = branchLabel(t, todos);
  return (
    <div data-todo-row={t.id} className={cx("flex w-full items-center gap-3 py-2 text-[13.5px]", t.branchOf && "pl-6")}>
      <button
        aria-label={t.done ? "Mark not done" : "Mark done"}
        onClick={() => onToggle(t.id)}
        className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border-[1.5px]"
        style={{ borderColor: t.color, background: t.done ? t.color : "transparent" }}
      />
      <button onClick={() => onOpen(t)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={cx("min-w-0 flex-1 truncate", t.done && "text-fg/40 line-through")}>{t.name}</span>
        {label && <span className="shrink-0 text-[12px] text-fg/45 tabular">{label}</span>}
        <span className="shrink-0 text-[12px] text-fg/50 tabular">
          {showDate && d && `${d.getMonth() + 1}/${d.getDate()} `}
          {time}
        </span>
      </button>
      <button
        aria-label="Branch this task"
        title="Branch: duplicate with its own time"
        onClick={() => branchTodo(t.id)}
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-fg/[0.1] hover:bg-fg/[0.06] hover:text-fg/70"
      >
        <BranchIcon size={14} />
      </button>
    </div>
  );
}

function DayRow({ x, onClick, showDate }: { x: Entry; onClick: () => void; showDate?: boolean }) {
  const time = x.allDay ? "All day" : `${fmtTime(x.start).replace(" ", " ")}–${fmtTime(x.end).replace(" ", " ")}`;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 py-2 text-left text-[13.5px]">
      <span className="w-[150px] shrink-0 text-fg/60 tabular">
        {showDate && `${new Date(x.start).getMonth() + 1}/${new Date(x.start).getDate()} `}
        {time}
      </span>
      {x.kind === "event" ? (
        <SmallCalIcon size={12} className="shrink-0" style={{ color: x.color }} />
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: x.color }} />
      )}
      <span className="truncate">{x.title}</span>
      {x.kind === "event" && <EventCalName calendarId={x.event.calendarId} />}
    </button>
  );
}

function EventCalName({ calendarId }: { calendarId: string }) {
  const label = useCalendarLabel(calendarId);
  return label ? <span className="ml-auto shrink-0 truncate pl-2 text-[11.5px] text-fg/40">{label}</span> : null;
}
