"use client";

import { useEffect, useState } from "react";
import { useSync } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { useNow } from "@/lib/hooks";
import { WEEKDAY_LONG, isSameDay, logicalDate } from "@/lib/time";
import { Segmented } from "../ui";
import { DiaryBox } from "./DiaryBox";
import { DiaryCalendar } from "./DiaryCalendar";

const VIEW_KEY = "sync-diary-view";
type View = "list" | "calendar";

/** Diary tab: the day notes as a list (newest first, today's box on top) or as a month calendar. */
export function DiaryView() {
  const now = useNow(60_000);
  const settings = useSync((s) => s.settings);
  const diary = useSync((s) => s.diary ?? []);
  const setDate = useUI((s) => s.setDate);
  const today = logicalDate(now, settings.dayStart);
  const [open, setOpen] = useState<number | null>(null);
  // which view is remembered on this device
  const [view, setView] = useState<View>("list");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(VIEW_KEY) === "calendar") setView("calendar");
    } catch {}
  }, []);
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  const past = [...diary].filter((x) => !isSameDay(x.date, today)).sort((a, b) => b.date - a.date);

  const label = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${WEEKDAY_LONG[d.getDay()]}`;
  };

  return (
    <div data-diary-view className="no-scrollbar h-full overflow-y-auto px-4 pb-[calc(var(--tabbar-h)+48px)] pt-[max(12px,env(safe-area-inset-top))]">
      <h1 className="pb-3 pt-2 text-center text-[17px] font-semibold">Diary</h1>
      <div className="mx-auto max-w-[760px]">
        <Segmented
          value={view}
          onChange={pick}
          size="sm"
          className="mx-auto mb-4 max-w-[220px]"
          options={[
            { value: "list", label: "List" },
            { value: "calendar", label: "Calendar" },
          ]}
        />
        {view === "calendar" ? (
          <DiaryCalendar today={today} />
        ) : (
          <>
            <p className="px-1 pb-1.5 text-[13px] font-medium text-fg/55">Today · {label(today)}</p>
            <DiaryBox date={today} />

            {past.length > 0 && <div className="mt-6 border-t border-fg/[0.08]" />}
            {past.map((x) => (
              <section key={x.id} data-diary-entry={x.id} className="border-b border-fg/[0.08] py-3">
                <div className="flex items-center justify-between px-1 pb-1">
                  <button className="text-[13px] font-medium text-fg/55 hover:text-fg/80" title="Show this day" onClick={() => setDate(x.date)}>
                    {label(x.date)}
                  </button>
                  <button onClick={() => setOpen(open === x.date ? null : x.date)} className="text-[12px] text-link">
                    {open === x.date ? "Done" : "Edit"}
                  </button>
                </div>
                {open === x.date ? <DiaryBox date={x.date} autoFocus /> : <p className="whitespace-pre-wrap px-1 text-[14px] leading-relaxed">{x.text}</p>}
              </section>
            ))}
            {past.length === 0 && <p className="py-8 text-center text-[13px] text-fg/40">Earlier notes will show up here.</p>}
          </>
        )}
      </div>
    </div>
  );
}
