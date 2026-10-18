"use client";

import { useRef, useState } from "react";
import { WEEKDAY_LETTER, addDays, isSameDay, startOfWeek } from "@/lib/time";
import { cx } from "../ui";

const SNAP_MS = 260;

/**
 * Week row under the Today header. The previous / current / next weeks sit side by side; dragging
 * moves them with the finger and releasing glides to the neighbouring week (or back), like the
 * original app. A tap selects a day.
 */
export function WeekStrip({
  date,
  today,
  weekStartsOn,
  onSelect,
}: {
  date: number;
  today: number;
  weekStartsOn: number;
  onSelect: (d: number) => void;
}) {
  const ws = startOfWeek(date, weekStartsOn);
  const weeks = [-7, 0, 7].map((o) => Array.from({ length: 7 }, (_, i) => addDays(ws, o + i)));
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; id: number; horizontal: boolean | null; lastX: number; lastT: number; v: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const suppressClick = useRef(false);

  function settle(dir: -1 | 0 | 1) {
    const w = box.current?.clientWidth ?? 0;
    setAnimating(true);
    setDx(-dir * w);
    window.setTimeout(() => {
      // same batch: the new week becomes the middle one and the offset resets — no jump
      setAnimating(false);
      setDx(0);
      if (dir !== 0) onSelect(addDays(date, dir * 7));
    }, SNAP_MS);
  }

  return (
    <div
      ref={box}
      className="touch-pan-y select-none overflow-hidden pb-3"
      onPointerDown={(e) => {
        if (animating) return;
        drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, horizontal: null, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.id) return;
        const mx = e.clientX - d.x;
        const my = e.clientY - d.y;
        if (d.horizontal === null && Math.hypot(mx, my) > 6) {
          d.horizontal = Math.abs(mx) > Math.abs(my);
          if (d.horizontal) box.current?.setPointerCapture(e.pointerId);
        }
        if (d.horizontal) {
          // velocity from the moves themselves (the release event repeats the last position)
          const dt = e.timeStamp - d.lastT;
          if (dt > 0) d.v = 0.7 * ((e.clientX - d.lastX) / dt) + 0.3 * d.v;
          d.lastX = e.clientX;
          d.lastT = e.timeStamp;
          setDx(mx);
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || !d.horizontal) return;
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
        const w = box.current?.clientWidth ?? 1;
        const mx = e.clientX - d.x;
        const recent = e.timeStamp - d.lastT < 100; // finger was still moving when lifted
        const flick = recent && Math.abs(d.v) > 0.35 && Math.sign(d.v) === Math.sign(mx);
        if (Math.abs(mx) > w * 0.25 || flick) settle(mx < 0 ? 1 : -1);
        else settle(0);
      }}
      onPointerCancel={() => {
        if (drag.current?.horizontal) settle(0);
        drag.current = null;
      }}
    >
      <div
        className="flex"
        style={{
          width: "300%",
          transform: `translateX(calc(-33.3333% + ${dx}px))`,
          transition: animating ? `transform ${SNAP_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1)` : "none",
        }}
      >
        {weeks.map((days, wi) => (
          <div key={wi} className="grid w-1/3 grid-cols-7 px-3">
            {days.map((d) => {
              const wd = new Date(d).getDay();
              const selected = isSameDay(d, date);
              const isToday = isSameDay(d, today);
              return (
                <button
                  key={d}
                  data-day={d}
                  onClick={() => !suppressClick.current && onSelect(d)}
                  className="flex flex-col items-center gap-1"
                  tabIndex={wi === 1 ? 0 : -1}
                  aria-hidden={wi !== 1}
                >
                  <span className="text-[11px] text-fg/55">{WEEKDAY_LETTER[wd]}</span>
                  <span
                    className={cx(
                      "flex h-[30px] w-[30px] items-center justify-center rounded-full text-[16px] tabular",
                      selected && "bg-fg font-semibold text-bg",
                      !selected && wd === 0 && "text-[#ff453a]",
                      !selected && wd === 6 && "text-[#0a84ff]",
                      !selected && isToday && "ring-1 ring-fg/50",
                    )}
                  >
                    {new Date(d).getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
