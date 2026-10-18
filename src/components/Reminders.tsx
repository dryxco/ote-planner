"use client";

import { useEffect, useRef, useState } from "react";
import type { Activity, Plan, ReminderOption, Settings } from "@/lib/types";
import { activityOf, planEndConfirmation, useSync } from "@/lib/store";
import { expandPlans, isOccurrenceKept } from "@/lib/plans";
import { MIN, fmtTime } from "@/lib/time";
import { useUI } from "@/lib/ui";
import { pushOnHere } from "@/lib/push-client";

const OFFSETS: Record<Exclude<ReminderOption, "activity">, number | null> = {
  none: null,
  atStart: 0,
  "5m": 5,
  "10m": 10,
  "30m": 30,
  "1h": 60,
};

function reminderOffset(plan: Plan, activities: Activity[], settings: Settings): number | null {
  const opt = plan.reminder === "activity" ? (activities.find((a) => a.id === plan.activityId)?.reminder ?? settings.defaultReminder) : plan.reminder;
  return OFFSETS[opt];
}

interface Toast {
  id: string;
  title: string;
  body: string;
  planId: string;
  start: number;
}

const FIRED_KEY = "sync-fired-reminders";
const CHECK_EVERY = 20_000;

/**
 * Fires plan start reminders and end confirmations while the app is open.
 * Uses system notifications when permitted, otherwise an in-app banner.
 * (A web page cannot notify when it is closed without a push server.)
 */
export function Reminders() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fired = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      fired.current = new Set(JSON.parse(localStorage.getItem(FIRED_KEY) ?? "[]") as string[]);
    } catch {}
    let last = Date.now();

    const check = () => {
      const now = Date.now();

      const { plans, actuals, activities, settings } = useSync.getState();
      const occ = expandPlans(plans, now - 2 * 3_600_000, now + 2 * 3_600_000).filter((o) => !o.plan.allDay);
      const fire = (key: string, title: string, body: string, planId: string, start: number) => {
        if (fired.current.has(key)) return;
        fired.current.add(key);
        try {
          localStorage.setItem(FIRED_KEY, JSON.stringify([...fired.current].slice(-300)));
        } catch {}
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
          const n = new Notification(title, { body, tag: key });
          n.onclick = () => {
            window.focus();
            if (planId) useUI.getState().openEntry({ mode: "edit", kind: "plan", id: planId, occurrenceStart: start });
          };
        } else {
          setToasts((t) => [...t, { id: key, title, body, planId, start }]);
        }
      };
      // a pomodoro that reached its end (also when the app was closed meanwhile)
      const tm = useSync.getState().timer;
      if (tm?.targetEnd && now >= tm.targetEnd) {
        useSync.getState().stopTimer(tm.targetEnd);
        fire(`pomodoro:${tm.start}`, "Focus session complete", `${tm.name || "Timer"} — recorded as an actual`, "", tm.start);
      }
      // this device gets the same alerts as pushes from the server: don't show them twice
      if (pushOnHere()) {
        last = now;
        return;
      }
      for (const o of occ) {
        const name = o.plan.name || activityOf(activities, o.plan.activityId).name;
        const off = reminderOffset(o.plan, activities, settings);
        if (off !== null) {
          const at = o.start - off * MIN;
          // fire when the reminder moment passed since the last check (no stale backlog)
          if (at <= now && at > last - CHECK_EVERY) {
            fire(`start:${o.key}`, off === 0 ? `${name} — now` : `${name} in ${off >= 60 ? "1 hour" : `${off} min`}`, `${fmtTime(o.start)}–${fmtTime(o.end)}`, o.plan.id, o.start);
          }
        }
        if (planEndConfirmation(o.plan, activities, settings) && o.end <= now && o.end > last - CHECK_EVERY && !isOccurrenceKept(o, actuals)) {
          fire(`end:${o.key}`, `Did you do "${name}"?`, "Confirm it on the Today screen.", o.plan.id, o.start);
        }
      }
      last = now;
    };
    check();
    const id = setInterval(check, CHECK_EVERY);
    return () => clearInterval(id);
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-3 pt-[max(10px,env(safe-area-inset-top))]">
      {toasts.slice(-3).map((t) => (
        <div
          key={t.id}
          className="animate-fade pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-[18px] border border-fg/10 bg-surface-2/95 px-4 py-3 shadow-2xl backdrop-blur-xl"
        >
          <button
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              if (t.planId) useUI.getState().openEntry({ mode: "edit", kind: "plan", id: t.planId, occurrenceStart: t.start });
              setToasts((x) => x.filter((y) => y.id !== t.id));
            }}
          >
            <p className="truncate text-[14px] font-semibold">{t.title}</p>
            <p className="truncate text-[12px] text-fg/60">{t.body}</p>
          </button>
          <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-[13px] text-fg/50">
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
