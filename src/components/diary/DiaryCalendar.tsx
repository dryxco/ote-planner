"use client";

import { useState } from "react";
import { useSync } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { WEEKDAY_LONG, WEEKDAY_SHORT, addDays, addMonths, isSameDay, startOfMonth, startOfWeek } from "@/lib/time";
import { ChevronLeft, ChevronRight } from "../icons";
import { cx } from "../ui";
import { DiaryBox } from "./DiaryBox";

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** The diary as a month: each day shows the start of its note; tap a day to read / write it below. */
export function DiaryCalendar({ today }: { today: number }) {
  const weekStartsOn = useSync((s) => s.settings.weekStartsOn);
  const diary = useSync((s) => s.diary ?? []);
  const setDate = useUI((s) => s.setDate);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [picked, setPicked] = useState(today);

  const notes = new Map(diary.filter((x) => x.text.trim()).map((x) => [dayKey(x.date), x.text]));
  const first = startOfWeek(month, weekStartsOn);
  const next = addMonths(month, 1);
  const weeks = Math.ceil((next - first) / (7 * 86_400_000) - 1e-9);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i));
  const m = new Date(month);
  const count = days.filter((d) => d >= month && d < next && notes.has(dayKey(d))).length;
  const pd = new Date(picked);

  return (
    <div data-diary-calendar>
      <div className="flex items-center gap-1 px-1 pb-2">
        <button aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-fg/60 hover:bg-fg/[0.08]">
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => {
            setMonth(startOfMonth(today));
            setPicked(today);
          }}
          title="This month"
          className="min-w-[110px] text-center text-[15px] font-semibold tabular"
        >
          {m.getFullYear()}.{m.getMonth() + 1}
        </button>
        <button aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-fg/60 hover:bg-fg/[0.08]">
          <ChevronRight size={14} />
        </button>
        <span className="ml-auto text-[12px] text-fg/45 tabular">{count} {count === 1 ? "note" : "notes"}</span>
      </div>

      <div className="grid grid-cols-7 pb-1 text-center text-[11px] text-fg/45">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i}>{WEEKDAY_SHORT[(weekStartsOn + i) % 7]}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[3px]">
        {days.map((d) => {
          const text = notes.get(dayKey(d));
          const inMonth = d >= month && d < next;
          const isToday = isSameDay(d, today);
          const sel = isSameDay(d, picked);
          return (
            <button
              key={d}
              data-diary-day={dayKey(d)}
              onClick={() => {
                setPicked(d);
                if (!inMonth) setMonth(startOfMonth(d));
              }}
              className={cx(
                "flex h-[78px] min-w-0 flex-col items-stretch rounded-[8px] p-1 text-left transition-colors sm:h-[96px]",
                text ? "bg-surface" : "bg-fg/[0.025]",
                !inMonth && "opacity-40",
                sel ? "ring-2 ring-link" : "hover:bg-fg/[0.06]",
              )}
            >
              <span
                className={cx(
                  "flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[11.5px] tabular",
                  isToday ? "bg-link font-semibold text-white" : "text-fg/70",
                )}
              >
                {new Date(d).getDate()}
              </span>
              {text && <span className="mt-0.5 line-clamp-3 break-words text-[10.5px] leading-[1.3] text-fg/75 sm:line-clamp-4">{text}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between px-1 pb-1.5">
        <button className="text-[13px] font-medium text-fg/55 hover:text-fg/80" title="Show this day" onClick={() => setDate(picked)}>
          {isSameDay(picked, today) ? "Today · " : ""}
          {pd.getFullYear()}.{pd.getMonth() + 1}.{pd.getDate()} {WEEKDAY_LONG[pd.getDay()]}
        </button>
      </div>
      <DiaryBox key={picked} date={picked} />
    </div>
  );
}
