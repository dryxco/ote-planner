"use client";

import { useState, type ReactNode } from "react";
import { OTHER_ID, activityOf, useSync } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { fmtDuration, logicalDate, MIN } from "@/lib/time";
import { goalDays, goalProgress, isDayGoal, periodEnd, periodLabelWithYear, periodRemainingLabel, periodStart, shiftPeriod, type PeriodKind } from "@/lib/stats";
import type { Goal } from "@/lib/types";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { PeriodBar, TabHeader } from "@/components/period";
import { BigButton, Footnote, Group, PopupSelect, Row, Segmented, Sheet } from "@/components/ui";

const TITLE: Record<PeriodKind, string> = { week: "This week's goals", month: "This month's goals", year: "This year's goals" };

type GoalTarget = { mode: "new" } | { mode: "edit"; goal: Goal };

export function GoalsView() {
  const now = useNow();
  const { goals, plans, actuals, settings } = useSync();
  const [kind, setKind] = useState<PeriodKind>("week");
  const [offset, setOffset] = useState(0);
  const [target, setTarget] = useState<GoalTarget | null>(null);

  const today = logicalDate(now, settings.dayStart);
  const start = shiftPeriod(kind, periodStart(kind, today, settings.weekStartsOn), offset);
  const end = periodEnd(kind, start);
  const list = goals.filter((g) => g.period === kind && g.periodStart === start).sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="flex h-full flex-col pt-[max(8px,env(safe-area-inset-top))]">
      <TabHeader title="Goals" />
      <PeriodBar
        kind={kind}
        onKind={(k) => {
          setKind(k);
          setOffset(0);
        }}
        label={periodLabelWithYear(kind, start)}
        sub={periodRemainingLabel(start, end, today)}
        onPrev={() => setOffset((o) => o - 1)}
        onNext={() => setOffset((o) => o + 1)}
        onLabel={() => setOffset(0)}
      />

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--tabbar-h)+48px)]">
        <h2 className="mb-2 mt-2.5 px-4 text-[15px] font-semibold text-fg/80">{offset === 0 ? TITLE[kind] : "Goals"}</h2>
        <div className="flex flex-col gap-2">
          {list.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              progress={isDayGoal(g) ? goalDays(g, plans, actuals, settings.dayStart, now) : goalProgress(g, actuals, settings.dayStart)}
              onClick={() => setTarget({ mode: "edit", goal: g })}
            />
          ))}
          <button onClick={() => setTarget({ mode: "new" })} className="flex h-[42px] items-center gap-3 rounded-full bg-surface px-4 text-[15px] text-link">
            <PlusIcon size={20} />
            Add
          </button>
        </div>
        <p className="mt-2 px-4 text-[11.5px] leading-snug text-fg/50">Set a goal on an activity and it fills in from your actuals.</p>
      </div>

      {target && (
        <GoalSheet
          key={target.mode === "edit" ? target.goal.id : "new"}
          target={target}
          kind={kind}
          periodStart={start}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

/** Total goals: amount / target. Daily and on-time goals: days kept / days judged so far. */
function GoalCard({ goal, progress, onClick }: { goal: Goal; progress: number | { kept: number; days: number }; onClick: () => void }) {
  const activities = useSync((s) => s.activities);
  const act = activityOf(activities, goal.activityId);
  const byDay = typeof progress !== "number";
  const [value, of] = byDay ? [progress.kept, progress.days] : [progress, goal.target];
  const pct = of > 0 ? Math.min(1, value / of) : 0;
  const fmt = (v: number) => (goal.kind === "time" ? fmtDuration(v * MIN) : String(v));
  const done = of > 0 && value >= of;
  const rule = goal.kind === "daily" ? ` · ${goal.target}× a day` : goal.kind === "onTime" ? " · on time" : "";
  return (
    <button onClick={onClick} className="rounded-[18px] bg-surface px-4 py-3 text-left">
      <div className="flex items-center gap-2 text-[15px]">
        <span className="h-[9px] w-[9px] rounded-full" style={{ background: act.color }} />
        <span className="flex-1 truncate">
          {act.name}
          {rule && <span className="text-fg/50">{rule}</span>}
        </span>
        {done && <CheckIcon size={15} className="text-[#30d158]" />}
        <span className="text-[13px] tabular">
          <span className="font-semibold">{fmt(value)}</span>
          <span className="text-fg/50">
            {" "}
            / {fmt(of)}
            {byDay && (of === 1 ? " day" : " days")}
          </span>
        </span>
      </div>
      <div className="mt-2 h-[8px] overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${act.color} 25%, var(--track))` }}>
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: act.color }} />
      </div>
    </button>
  );
}

/** Time targets offered in the picker (minutes). */
const TIME_TARGETS = [
  15, 30, 45,
  ...Array.from({ length: 23 }, (_, i) => 60 + i * 30), // 1h … 12h every 30m
  ...Array.from({ length: 88 }, (_, i) => (13 + i) * 60), // 13h … 100h
  ...Array.from({ length: 40 }, (_, i) => (110 + i * 10) * 60), // 110h … 500h
].map((m) => ({ value: m, label: fmtDuration(m * MIN) }));

function GoalSheet({ target, kind, periodStart, onClose }: { target: GoalTarget; kind: PeriodKind; periodStart: number; onClose: () => void }) {
  const { activities, addGoal, updateGoal, deleteGoal } = useSync();
  const g = target.mode === "edit" ? target.goal : undefined;
  const [goalKind, setGoalKind] = useState<Goal["kind"]>(g?.kind ?? "time");
  const [activityId, setActivityId] = useState(g?.activityId ?? OTHER_ID);
  const [minutes, setMinutes] = useState(g?.kind === "time" ? g.target : 60);
  const [count, setCount] = useState(g?.kind === "count" || g?.kind === "daily" ? g.target : 5);

  const save = () => {
    const data = { kind: goalKind, activityId, target: goalKind === "time" ? minutes : goalKind === "onTime" ? 1 : count };
    if (g) updateGoal(g.id, data);
    else addGoal({ ...data, period: kind, periodStart });
    onClose();
  };
  const options = [...activities].sort((a, b) => a.order - b.order).map((a) => ({ value: a.id, label: a.name }));
  const timeOptions = TIME_TARGETS.some((o) => o.value === minutes) ? TIME_TARGETS : [{ value: minutes, label: fmtDuration(minutes * MIN) }, ...TIME_TARGETS];

  return (
    <Sheet compact title={g ? "Edit goal" : "Add goal"} onCancel={onClose} onSave={save} saveDisabled={(goalKind === "count" || goalKind === "daily") && count < 1}>
      <Segmented
        className="mx-1 mb-6 mt-3 bg-surface-2"
        value={goalKind}
        options={[
          { value: "time", label: "Time" },
          { value: "count", label: "Count" },
          { value: "daily", label: "Daily" },
          { value: "onTime", label: "On time" },
        ]}
        onChange={setGoalKind}
      />
      <Group>
        <Row label="Activity">
          <PopupSelect tone="plain" value={activityId} options={options} onChange={setActivityId} />
        </Row>
        {goalKind !== "onTime" && (
          <Row label={goalKind === "daily" ? "Each day" : "Target"}>
            {goalKind === "time" ? (
              <TargetPill>
                <span>{fmtDuration(minutes * MIN)}</span>
                <select
                  aria-label="Target time"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                >
                  {timeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </TargetPill>
            ) : (
              <div className="flex items-center gap-1">
                <StepButton label="Decrease" disabled={count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))}>
                  −
                </StepButton>
                <TargetPill>
                  <span className="min-w-[1.5em] text-center tabular">{count}</span>
                </TargetPill>
                <StepButton label="Increase" onClick={() => setCount((c) => Math.min(999, c + 1))}>
                  +
                </StepButton>
              </div>
            )}
          </Row>
        )}
      </Group>
      {goalKind === "daily" && <Footnote>A day counts when it has at least this many records of the activity.</Footnote>}
      {goalKind === "onTime" && (
        <Footnote>
          A day counts when the activity&apos;s first actual starts no later than its first plan that day. Days without a plan of it
          are left out.
        </Footnote>
      )}
      {g && (
        <div className="mt-6">
          <BigButton
            tone="danger"
            onClick={() => {
              deleteGoal(g.id);
              onClose();
            }}
          >
            Delete goal
          </BigButton>
        </div>
      )}
    </Sheet>
  );
}

function TargetPill({ children }: { children: ReactNode }) {
  return <label className="relative flex items-center rounded-[8px] bg-surface-3 px-2.5 py-1 text-[15px] font-medium">{children}</label>;
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[30px] w-[34px] items-center justify-center rounded-[8px] bg-surface-3 text-[18px] disabled:opacity-35"
    >
      {children}
    </button>
  );
}
