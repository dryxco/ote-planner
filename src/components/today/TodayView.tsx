"use client";

import { useState } from "react";
import { useSync, activityOf } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { useCalendarEvents, useNow } from "@/lib/hooks";
import { expandPlans } from "@/lib/plans";
import { WEEKDAY_LONG, addDays, logicalDate, logicalDayRange, pad2, HOUR } from "@/lib/time";
import { PlayIcon, SlidersIcon, StopIcon } from "@/components/icons";
import { Timeline } from "@/components/today/Timeline";
import { WeekStrip } from "@/components/today/WeekStrip";
import { DaySwipe } from "@/components/today/DaySwipe";
import { cx } from "@/components/ui";
import { AgentChat } from "@/components/AgentChat";
import { AlertsPrompt } from "@/components/AlertsPrompt";

export function TodayView() {
  const now = useNow(15_000);
  const settings = useSync((s) => s.settings);
  const date = useUI((s) => s.date);
  const setDate = useUI((s) => s.setDate);
  const setSettingsOpen = useUI((s) => s.setSettingsOpen);
  const today = logicalDate(now, settings.dayStart);

  const [start, end] = logicalDayRange(date, settings.dayStart);
  // from midnight: events between 00:00 and the day start also show above this day's timeline
  const { events, errors } = useCalendarEvents(Math.min(date, start), end);

  const d = new Date(date);
  const diff = Math.round((date - today) / 86_400_000);
  const rel = diff === 0 ? "Today" : diff === -1 ? "Yesterday" : diff === 1 ? "Tomorrow" : null;

  return (
    <div className="flex h-full flex-col pt-[max(12px,env(safe-area-inset-top))]">
      {/* the weekday leads; the date and how far it is from today sit under it */}
      <header className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-1">
        <button data-today-date onClick={() => setDate(today)} className="flex min-w-0 flex-col items-start text-left">
          <span className="text-[24px] font-semibold leading-[1.1] tracking-[-0.02em]">{WEEKDAY_LONG[d.getDay()]}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-fg/55 tabular">
            {d.toLocaleString("en-US", { month: "long" })} {d.getDate()}
            {rel && (
              <>
                <span className={cx("h-[5px] w-[5px] rounded-full", rel === "Today" ? "bg-now" : "bg-fg/35")} />
                <span className={rel === "Today" ? "font-medium text-now" : ""}>{rel}</span>
              </>
            )}
          </span>
        </button>
        <div className="relative z-30 flex shrink-0 items-center gap-1 pt-1">
          {date !== today && (
            <button
              aria-label="Go to today"
              onClick={() => setDate(today)}
              className="mr-1 h-[30px] rounded-[9px] border border-fg/[0.12] px-2.5 text-[12.5px] font-semibold text-fg/80 hover:bg-fg/[0.06]"
            >
              Today
            </button>
          )}
          <AgentChat />
          <button aria-label="Settings" onClick={() => setSettingsOpen(true)} className="flex h-[32px] w-[32px] items-center justify-center rounded-[9px] text-fg/75 hover:bg-fg/[0.06]">
            <SlidersIcon size={20} />
          </button>
        </div>
      </header>

      <WeekStrip date={date} today={today} weekStartsOn={settings.weekStartsOn} onSelect={setDate} />

      {errors.length > 0 && (
        <button
          onClick={() => setSettingsOpen(true)}
          className="mx-4 mb-2 truncate rounded-lg bg-[#ff453a]/15 px-3 py-1.5 text-left text-[12px] text-danger-soft"
          title={errors.join("\n")}
        >
          ⚠︎ {errors[0]}
        </button>
      )}

      <AlertsPrompt />
      <DaySwipe onDay={(d) => setDate(addDays(date, d))}>
        <Timeline date={date} now={now} events={events} />
      </DaySwipe>

      <TimerButton now={now} />
    </div>
  );
}

function TimerButton({ now }: { now: number }) {
  const { timer, startTimer, stopTimer, cancelTimer, activities, plans } = useSync();
  const [picking, setPicking] = useState(false);
  const tick = useNow(1000);

  if (timer) {
    const secs = Math.max(0, Math.floor((tick - timer.start) / 1000));
    const h = Math.floor(secs / 3600);
    const label = `${h ? `${h}:` : ""}${pad2(Math.floor((secs % 3600) / 60))}:${pad2(secs % 60)}`;
    const short = secs < 60; // under a minute isn't recorded
    return (
      <>
        <button
          aria-label="Timer options"
          onClick={() => setPicking((v) => !v)}
          className="absolute bottom-[calc(var(--tabbar-h)+12px)] left-4 z-20 flex h-[44px] items-center gap-2.5 rounded-[14px] border border-now/40 bg-surface py-1 pl-1 pr-3.5 text-[14px] font-medium shadow-[0_6px_24px_rgba(0,0,0,0.18)]"
        >
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-now text-now-ink">
            <StopIcon size={12} />
          </span>
          <span className="max-w-[120px] truncate">{timer.name || activityOf(activities, timer.activityId).name}</span>
          <span className="tabular text-now">{label}</span>
        </button>
        {picking && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setPicking(false)} />
            <div data-timer-menu className="animate-fade absolute bottom-[calc(var(--tabbar-h)+64px)] left-4 z-40 w-[230px] overflow-hidden rounded-[14px] border border-fg/10 bg-surface-2/95 py-1 shadow-2xl backdrop-blur-xl">
              <p className="px-3.5 pb-1 pt-1.5 text-[11px] text-fg/45">
                {timer.targetEnd ? "Pomodoro" : "Timer"} · {label}
              </p>
              <button
                disabled={short}
                onClick={() => {
                  setPicking(false);
                  stopTimer();
                }}
                className="flex w-full items-center justify-between px-3.5 py-2 text-left text-[14px] disabled:text-fg/35"
              >
                Stop &amp; record
                {short && <span className="text-[11px]">under a minute</span>}
              </button>
              <button
                onClick={() => {
                  setPicking(false);
                  cancelTimer();
                }}
                className="w-full px-3.5 py-2 text-left text-[14px] text-danger-soft"
              >
                Discard
              </button>
              <button onClick={() => setPicking(false)} className="w-full px-3.5 py-2 text-left text-[14px] text-fg/60">
                Keep going
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  // Plans happening right now are offered first ("Start now").
  const current = expandPlans(plans, now - 12 * HOUR, now + HOUR).filter((o) => o.start <= now + 15 * 60_000 && o.end > now && !o.plan.allDay);

  return (
    <>
      <button
        onClick={() => setPicking((v) => !v)}
        className="absolute bottom-[calc(var(--tabbar-h)+12px)] left-4 z-20 flex h-[44px] items-center gap-2.5 rounded-[14px] border border-fg/10 bg-surface py-1 pl-1 pr-3.5 text-[14px] font-medium shadow-[0_6px_24px_rgba(0,0,0,0.18)]"
      >
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-now text-now-ink">
          <PlayIcon size={12} />
        </span>
        Timer
      </button>
      {picking && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPicking(false)} />
          <div className="animate-fade absolute bottom-[calc(var(--tabbar-h)+64px)] left-4 z-40 w-[230px] overflow-hidden rounded-[14px] border border-fg/10 bg-surface-2/95 shadow-2xl backdrop-blur-xl">
            <p className="px-3.5 pb-1 pt-2.5 text-[11px] text-fg/45">Start a timer</p>
            {current.map((o) => (
              <PickRow
                key={o.key}
                color={o.plan.color}
                label={o.plan.name || activityOf(activities, o.plan.activityId).name}
                hint="Now planned"
                onClick={() => {
                  startTimer({ activityId: o.plan.activityId, name: o.plan.name, color: o.plan.color, planKey: o.key });
                  setPicking(false);
                }}
              />
            ))}
            {activities.map((a) => (
              <PickRow
                key={a.id}
                color={a.color}
                label={a.name}
                onClick={() => {
                  startTimer({ activityId: a.id, name: "", color: a.color });
                  setPicking(false);
                }}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function PickRow({ color, label, hint, onClick }: { color: string; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx("flex w-full items-center gap-2.5 border-t border-fg/[0.07] px-3.5 py-2.5 text-left text-[14px] hover:bg-fg/5")}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[11px] text-link">{hint}</span>}
    </button>
  );
}
