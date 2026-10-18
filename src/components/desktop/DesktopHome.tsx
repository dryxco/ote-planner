"use client";

import { useRef, useState } from "react";
import { CalendarView } from "../calendar/CalendarView";
import { TodayView } from "../today/TodayView";
import { PomodoroPanel } from "./PomodoroPanel";
import { TasksPanel } from "./TasksPanel";

const SIZE_KEY = "sync-desktop-panes";
const LEFT = { min: 260, max: 640, initial: 360 };
const RIGHT = { min: 340, max: 820, initial: 440 };
const MIDDLE_MIN = 320;

function loadSizes(): { left: number; right: number } {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "null") as { left: number; right: number } | null;
    if (v && v.left > 0 && v.right > 0) return v;
  } catch {}
  return { left: LEFT.initial, right: RIGHT.initial };
}

/**
 * Computer layout: calendar on the left, tasks over a pomodoro in the middle, and the
 * Plan | Actual timeline on the right. All three share the selected date. Drag the gutters between
 * panes to resize them (remembered per device; double-click a gutter to reset).
 */
export function DesktopHome() {
  const [sizes, setSizes] = useState(loadSizes);
  const box = useRef<HTMLDivElement>(null);

  const save = (v: { left: number; right: number }) => {
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(v));
    } catch {}
  };

  function startResize(side: "left" | "right", e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const from = sizes;
    const total = box.current?.clientWidth ?? 1400;
    let latest = from;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const lim = (v: number, r: { min: number; max: number }, other: number) =>
        Math.max(r.min, Math.min(r.max, total - other - MIDDLE_MIN - 48, v));
      latest =
        side === "left"
          ? { ...from, left: lim(from.left + dx, LEFT, from.right) }
          : { ...from, right: lim(from.right - dx, RIGHT, from.left) };
      setSizes(latest);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      save(latest);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function reset(side: "left" | "right") {
    const v = side === "left" ? { ...sizes, left: LEFT.initial } : { ...sizes, right: RIGHT.initial };
    setSizes(v);
    save(v);
  }

  const gutter = (side: "left" | "right") => (
    <div
      data-resize={side}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} pane`}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => startResize(side, e)}
      onDoubleClick={() => reset(side)}
      className="group relative w-4 shrink-0 cursor-col-resize touch-none"
    >
      <div className="absolute inset-y-[30%] left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-fg/0 transition-colors group-hover:bg-fg/25 group-active:bg-link" />
    </div>
  );

  return (
    <div ref={box} data-desktop-home className="flex h-full min-h-0 p-4">
      <div data-pane="left" className="relative min-h-0 shrink-0 overflow-hidden rounded-[18px] border border-fg/[0.07] bg-bg" style={{ width: sizes.left }}>
        <CalendarView />
      </div>
      {gutter("left")}
      <div className="flex min-h-0 min-w-[320px] flex-1 flex-col gap-4">
        <TasksPanel />
        <PomodoroPanel />
      </div>
      {gutter("right")}
      <div data-pane="right" className="relative min-h-0 shrink-0 overflow-hidden rounded-[18px] border border-fg/[0.07] bg-bg" style={{ width: sizes.right }}>
        <TodayView />
      </div>
    </div>
  );
}
