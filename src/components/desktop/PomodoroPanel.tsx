"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OTHER_ID, activityOf, useSync } from "@/lib/store";
import { expandPlans } from "@/lib/plans";
import type { Todo } from "@/lib/types";
import { useUI } from "@/lib/ui";
import { useNow } from "@/lib/hooks";
import { MIN, isSameDay, pad2 } from "@/lib/time";
import { cx } from "../ui";

const LENGTHS = [15, 25, 50];

/**
 * Desktop centre-bottom: a pomodoro on top of Sync's timer. Starting it runs the regular timer with
 * a target end; when the time is up the timer stops itself and the session is recorded as an actual
 * (Reminders also does this if the panel isn't open). The dial's red sector is the time left.
 */
export function PomodoroPanel() {
  const { todos, activities, timer, startTimer, stopTimer, cancelTimer } = useSync();
  const date = useUI((s) => s.date);
  const now = useNow(1000);
  const [picked, setPick] = useState<string>("");
  const [length, setLength] = useState(25);
  const [hidden, setHidden] = usePomodoroHidden();
  const [storedH, setStoredH] = usePomodoroHeight();
  const [dragH, setDragH] = useState<number | null>(null);
  const card = useRef<HTMLElement>(null);
  const box = useCardBox(card, !hidden);

  // tasks that fit right now come first: scheduled over this moment, or attached to the plan in progress
  const plans = useSync((st) => st.plans);
  const inPlanNow = new Set(
    expandPlans(plans, now - 1, now + 1)
      .filter((o) => !o.plan.allDay && o.start <= now && now < o.end)
      .map((o) => o.plan.id),
  );
  const fitsNow = (t: Todo) => {
    if (t.planId && inPlanNow.has(t.planId)) return true;
    if (t.date === undefined || t.time === undefined) return false;
    const st = t.date + t.time * 60_000;
    return st <= now && now < st + Math.max(t.duration ?? 0, 1) * 60_000;
  };
  const listed = todos.filter((t) => !t.done && (t.date === undefined || isSameDay(t.date, date)));
  const choices = [
    ...[...listed.filter(fitsNow), ...listed.filter((t) => !fitsNow(t))].map((t) => ({
      value: `todo:${t.id}`,
      label: fitsNow(t) ? `● ${t.name} (now)` : t.name,
    })),
    ...activities.filter((a) => !a.archived).map((a) => ({ value: `act:${a.id}`, label: `· ${a.name}` })),
  ];

  // nothing chosen yet: the task that fits right now is preselected
  const nowTask = listed.find(fitsNow);
  const pick = picked || (nowTask ? `todo:${nowTask.id}` : "");

  const running = !!timer;
  const isPomo = !!timer?.targetEnd;
  const total = isPomo ? timer!.targetEnd! - timer!.start : length * MIN;
  const left = isPomo ? Math.max(0, timer!.targetEnd! - now) : running ? 0 : length * MIN;
  const elapsed = running ? now - timer!.start : 0;
  const shown = isPomo || !running ? left : elapsed;
  // like a kitchen timer: the red sector is the time left on a 60-minute face
  const frac = isPomo ? left / (60 * MIN) : running ? 0 : (length * MIN) / (60 * MIN);
  void total;

  // finished while visible: stop now (Reminders covers the case where this panel isn't open)
  const targetEnd = timer?.targetEnd;
  useEffect(() => {
    if (targetEnd && now >= targetEnd) useSync.getState().stopTimer(targetEnd);
  }, [now, targetEnd]);

  /** Dragging the dial: before starting it sets the length, while running it sets the time left. */
  function setMinutes(m: number) {
    const tm = useSync.getState().timer;
    if (!tm) setLength(m);
    else if (tm.targetEnd) useSync.setState({ timer: { ...tm, targetEnd: Date.now() + m * MIN } });
  }

  function start() {
    let activityId = OTHER_ID;
    let name = "";
    let todoId: string | undefined;
    if (pick.startsWith("todo:")) {
      const t = todos.find((x) => x.id === pick.slice(5));
      if (t) {
        activityId = t.activityId;
        name = t.name;
        todoId = t.id;
      }
    } else if (pick.startsWith("act:")) activityId = pick.slice(4);
    const act = activityOf(activities, activityId);
    const color = todoId ? (todos.find((x) => x.id === todoId)?.color ?? act.color) : act.color;
    startTimer({ activityId, name, color, todoId, targetEnd: Date.now() + length * MIN });
    // exactly `length` minutes from the recorded start (not the millisecond before it)
    const tm = useSync.getState().timer;
    if (tm) useSync.setState({ timer: { ...tm, targetEnd: tm.start + length * MIN } });
  }

  const mm = Math.floor(shown / 60000);
  const ss = Math.floor((shown % 60000) / 1000);
  const label = timer ? timer.name || activityOf(activities, timer.activityId).name : null;

  if (hidden) {
    return (
      <button
        data-pomodoro-show
        onClick={() => setHidden(false)}
        className="flex shrink-0 items-center gap-2 self-start rounded-full border border-fg/10 bg-surface-0 px-3 py-1.5 text-[12px] text-fg/60"
        title="Show pomodoro"
      >
        <span className={cx("h-[6px] w-[6px] rounded-full", running ? "bg-[#ff453a]" : "bg-fg/30")} />
        Pomodoro
        {running && (
          <span className="tabular text-fg/85">
            {pad2(mm)}:{pad2(ss)}
          </span>
        )}
      </button>
    );
  }

  /** Dragging the top edge up makes the card taller (the tasks above shrink); remembered per device. */
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const from = card.current?.offsetHeight ?? MIN_H;
    const max = maxHeight(card.current?.parentElement?.clientHeight ?? 0);
    let latest = from;
    const move = (ev: PointerEvent) => {
      latest = Math.round(Math.max(MIN_H, Math.min(max, from - (ev.clientY - y0))));
      setDragH(latest);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDragH(null);
      setStoredH(latest < MIN_H + 12 ? null : latest); // back near the bottom: plain compact card
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  // the stored height, kept inside what the column allows right now (the window may have shrunk)
  const wanted = dragH ?? storedH;
  const height = wanted === null ? null : box.colH ? Math.max(MIN_H, Math.min(maxHeight(box.colH), wanted)) : wanted;
  const tall = height !== null && height >= TALL_AT;

  const dot = <span className={cx("h-[6px] w-[6px] shrink-0 rounded-full", running ? "bg-[#ff453a]" : "bg-fg/30")} />;
  const taskSelect = running ? (
    <span className="truncate font-medium text-fg/90">{label}</span>
  ) : (
    <select
      aria-label="Select task"
      value={pick}
      onChange={(e) => setPick(e.target.value)}
      className={cx("min-w-0 truncate bg-transparent text-[12px] outline-none", tall ? "max-w-full text-center" : "flex-1")}
    >
      <option value="">Select task</option>
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
  const hideBtn = (
    <button aria-label="Hide pomodoro" title="Hide" onClick={() => setHidden(true)} className="ml-auto shrink-0 px-1 text-[12px] text-fg/40 hover:text-fg/70">
      Hide
    </button>
  );
  const chips =
    !running &&
    LENGTHS.map((m) => (
      <button
        key={m}
        onClick={() => setLength(m)}
        className={cx("rounded-full px-2 py-0.5 text-[11px]", length === m ? "bg-fg/15 text-fg" : "text-fg/55")}
      >
        {m}m
      </button>
    ));
  const actions = (
    <>
      <button
        onClick={() => (running ? stopTimer() : start())}
        title={running ? "Stop and record the time as an actual" : "Start"}
        className="h-[28px] rounded-[8px] bg-[#c4533a] px-3 text-[13px] font-semibold text-white"
      >
        {running ? "Stop" : "Start"}
      </button>
      <button
        onClick={() => (running ? cancelTimer() : setLength(25))}
        className="h-[28px] rounded-[8px] border border-fg/15 px-2.5 text-[13px] text-fg/85"
        title={running ? "Discard this session (nothing recorded)" : "Back to 25 minutes"}
      >
        Reset
      </button>
    </>
  );
  const time = (size: number) => (
    <span data-pomodoro-time className="font-semibold leading-none tabular" style={{ fontSize: size }}>
      {pad2(mm)}:{pad2(ss)}
    </span>
  );

  // tall: one big centred timer, the time text and the dial scaled to the room there is
  const timeSize = height === null ? 20 : tall ? Math.round(Math.max(48, Math.min(96, height * 0.16))) : 20;
  const dialSize = tall
    ? Math.max(COMPACT_DIAL, Math.min(box.w - 48 || Infinity, height! - TALL_CHROME - timeSize))
    : height === null
      ? COMPACT_DIAL
      : Math.max(COMPACT_DIAL, Math.min(COMPACT_DIAL_MAX, height - (MIN_H - COMPACT_DIAL)));

  return (
    <section
      ref={card}
      data-pomodoro
      data-pomodoro-tall={tall || undefined}
      style={height === null ? undefined : { height }}
      className={cx(
        "relative flex shrink-0 rounded-[14px] border border-fg/[0.07] bg-surface-0",
        tall ? "flex-col items-center justify-center gap-2.5 px-4 py-3" : "items-center gap-3 px-3 py-2.5",
      )}
    >
      <div
        data-pomodoro-resize
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize pomodoro"
        title="Drag to resize · double-click to reset"
        onPointerDown={startResize}
        onDoubleClick={() => setStoredH(null)}
        className="group absolute inset-x-6 -top-[5px] z-10 flex h-[8px] cursor-row-resize touch-none items-center justify-center"
      >
        <div className="h-[3px] w-10 rounded-full bg-fg/0 transition-colors group-hover:bg-fg/25 group-active:bg-link" />
      </div>
      {tall ? (
        <>
          <div className="flex w-full items-center gap-1.5 text-[12px] text-fg/70">
            <span className="w-[34px] shrink-0" />
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
              {dot}
              {taskSelect}
            </div>
            <span className="flex w-[34px] shrink-0 justify-end">{hideBtn}</span>
          </div>
          <Dial size={dialSize} frac={frac} onSet={setMinutes} />
          {time(timeSize)}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {chips}
            <span className={cx("flex gap-1.5", !running && "ml-2")}>{actions}</span>
          </div>
        </>
      ) : (
        <>
          <Dial size={dialSize} frac={frac} onSet={setMinutes} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-[12px] text-fg/70">
              {dot}
              {taskSelect}
              {hideBtn}
            </div>
            <div className="flex items-center gap-2">
              {time(timeSize)}
              {chips}
              <span className="ml-auto flex gap-1.5">{actions}</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Compact card height (one row: the 76px dial plus padding) — also the least it can be dragged to. */
const MIN_H = 98;
const COMPACT_DIAL = 76;
const COMPACT_DIAL_MAX = 110;
/** From this height on the card switches to the big centred timer. */
const TALL_AT = 240;
/** Tall layout, everything but the dial and the time text: padding, task row, controls row, gaps. */
const TALL_CHROME = 24 + 2 + 20 + 28 + 3 * 10;
/** At most ~70% of the column, and the tasks above keep at least 160px (plus the 16px gap). */
const maxHeight = (col: number) => (col ? Math.max(MIN_H, Math.min(col * 0.7, col - 160 - 16)) : 10_000);

const HEIGHT_KEY = "sync-pomodoro-height";
const heightListeners = new Set<() => void>();

/** The card height the user dragged it to (per device); null = the compact one-row card. */
function usePomodoroHeight(): [number | null, (v: number | null) => void] {
  const h = useSyncExternalStore(
    (cb) => {
      heightListeners.add(cb);
      return () => heightListeners.delete(cb);
    },
    () => {
      try {
        const v = Number(localStorage.getItem(HEIGHT_KEY));
        return v > 0 ? v : null;
      } catch {
        return null;
      }
    },
    () => null,
  );
  const set = (v: number | null) => {
    try {
      if (v === null) localStorage.removeItem(HEIGHT_KEY);
      else localStorage.setItem(HEIGHT_KEY, String(v));
    } catch {}
    heightListeners.forEach((l) => l());
  };
  return [h, set];
}

/** The card's width and its column's height, kept up to date. */
function useCardBox(card: React.RefObject<HTMLElement | null>, active: boolean) {
  const [box, setBox] = useState({ w: 0, colH: 0 });
  useEffect(() => {
    const el = card.current;
    const col = el?.parentElement;
    if (!el || !col) return;
    const read = () => setBox((b) => (b.w === el.clientWidth && b.colH === col.clientHeight ? b : { w: el.clientWidth, colH: col.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    ro.observe(col);
    return () => ro.disconnect();
  }, [card, active]);
  return box;
}

const HIDDEN_KEY = "sync-pomodoro-hidden";
const hiddenListeners = new Set<() => void>();

/** Whether the pomodoro is collapsed to a small pill (per device). */
function usePomodoroHidden(): [boolean, (v: boolean) => void] {
  const hidden = useSyncExternalStore(
    (cb) => {
      hiddenListeners.add(cb);
      return () => hiddenListeners.delete(cb);
    },
    () => {
      try {
        return localStorage.getItem(HIDDEN_KEY) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const set = (v: boolean) => {
    try {
      localStorage.setItem(HIDDEN_KEY, v ? "1" : "0");
    } catch {}
    hiddenListeners.forEach((l) => l());
  };
  return [hidden, set];
}

/**
 * Clock-face dial: minute ticks and a red sector for the time left (full circle = 60 minutes).
 * Drag around it (like turning a kitchen timer) to set whole minutes, 1–60.
 */
function Dial({ size, frac, onSet }: { size: number; frac: number; onSet: (minutes: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const prev = useRef<number | null>(null);
  const minutesAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const ang = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
    let m = Math.round((((ang + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * 60);
    // crossing 12 o'clock mid-drag: stick to the end you came from instead of jumping 60 <-> 0
    if (prev.current !== null && Math.abs(m - prev.current) > 30) m = prev.current > 30 ? 60 : 0;
    prev.current = m;
    return Math.max(1, Math.min(60, m));
  };
  const R = 84;
  const C = 100;
  const a = Math.max(0, Math.min(1, frac)) * 2 * Math.PI;
  const end = { x: C + R * Math.sin(a), y: C - R * Math.cos(a) };
  const sector =
    frac >= 0.9999
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} Z`
      : frac <= 0
        ? ""
        : `M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 ${a > Math.PI ? 1 : 0} 1 ${end.x} ${end.y} Z`;
  return (
    <svg
      ref={ref}
      data-dial
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
      aria-label="Drag to set minutes"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        prev.current = null; // a press jumps straight to where you pressed
        onSet(minutesAt(e));
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && onSet(minutesAt(e))}
      onPointerUp={() => (prev.current = null)}
    >
      <circle cx={C} cy={C} r={R} fill="var(--surface)" />
      {sector && <path d={sector} fill="#d94b3a" />}
      {Array.from({ length: 60 }, (_, i) => {
        const t = (i / 60) * 2 * Math.PI;
        const long = i % 5 === 0;
        const r1 = R + 4;
        const r2 = R + (long ? 11 : 7);
        return (
          <line
            key={i}
            x1={C + r1 * Math.sin(t)}
            y1={C - r1 * Math.cos(t)}
            x2={C + r2 * Math.sin(t)}
            y2={C - r2 * Math.cos(t)}
            stroke="var(--fg)"
            strokeOpacity={long ? 0.55 : 0.22}
            strokeWidth={long ? 1.6 : 1}
          />
        );
      })}
    </svg>
  );
}
