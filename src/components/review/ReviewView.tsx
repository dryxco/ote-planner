"use client";

import { useMemo, useState } from "react";
import { useSync, activityOf } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { logicalDate, fmtDuration } from "@/lib/time";
import {
  computeReview,
  fmtPct,
  periodLabel,
  periodStart,
  shiftPeriod,
  type ActivityStat,
  type PeriodKind,
  type ReviewStats,
} from "@/lib/stats";
import { ChevronRight, HistoryIcon } from "@/components/icons";
import { PeriodBar, TabHeader } from "@/components/period";
import { Sheet } from "@/components/ui";
import { ActivityRow, Legend, ScoreCard } from "@/components/stats-ui";

const PREV_LABEL: Record<PeriodKind, string> = { week: "last week", month: "last month", year: "last year" };
const CHART_TITLE: Record<PeriodKind, string> = { week: "By weekday", month: "By week", year: "By month" };
const UNIT: Record<PeriodKind, string> = { week: "week", month: "month", year: "year" };

export function ReviewView() {
  const now = useNow();
  const { plans, actuals, activities, settings } = useSync();
  const [kind, setKind] = useState<PeriodKind>("week");
  const [offset, setOffset] = useState(0);
  const [comparing, setComparing] = useState(false);

  const today = logicalDate(now, settings.dayStart);
  const start = shiftPeriod(kind, periodStart(kind, today, settings.weekStartsOn), offset);
  const prevStart = shiftPeriod(kind, start, -1);

  const stats = useMemo(() => {
    const base = { plans, actuals, kind, dayStart: settings.dayStart, weekStartsOn: settings.weekStartsOn, now };
    return { cur: computeReview({ ...base, start }), prev: computeReview({ ...base, start: prevStart }) };
  }, [plans, actuals, kind, settings.dayStart, settings.weekStartsOn, now, start, prevStart]);
  const { cur, prev } = stats;

  const rows = orderRows(cur.activities, activities);

  return (
    <div className="flex h-full flex-col pt-[max(8px,env(safe-area-inset-top))]">
      <TabHeader title="Review" />
      <PeriodBar
        kind={kind}
        onKind={(k) => {
          setKind(k);
          setOffset(0);
        }}
        label={periodLabel(kind, start)}
        onPrev={() => setOffset((o) => o - 1)}
        onNext={() => setOffset((o) => o + 1)}
        onLabel={() => setOffset(0)}
      />

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--tabbar-h)+48px)]">
        <div className="flex gap-2.5 pt-3">
          <ScoreCard label="On time" value={cur.sync} prev={prev.sync} prevLabel={PREV_LABEL[kind]} />
          <ScoreCard label="Done" value={cur.attainment} prev={prev.attainment} prevLabel={PREV_LABEL[kind]} />
        </div>

        <div className="mt-2.5 rounded-[16px] bg-surface px-3.5 pb-3 pt-3.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.11em] text-fg/45">{CHART_TITLE[kind]} · on time</h3>
            <span className="text-[11.5px] text-fg/50 tabular">
              Days with a plan <span className="font-semibold text-fg">{cur.daysWithPlan}/{cur.totalDays}</span>
            </span>
          </div>
          <BarChart buckets={cur.buckets} />
        </div>

        <div className="mt-2.5 rounded-[16px] bg-surface px-3.5 pb-4 pt-3.5">
          <ActivityRow name="All" stat={cur} actual={cur.actual} strong />
          <div className="mt-2 flex gap-3 pl-5 text-[10.5px] text-fg/50">
            <Legend color="var(--matched)" label="Matched plan" />
            <Legend color="var(--elsewhere)" label="At another time" />
          </div>
          {rows.length > 0 && (
            <div className="mt-4 flex flex-col gap-3.5 border-t border-fg/[0.07] pt-4">
              {rows.map((r) => {
                const a = activityOf(activities, r.activityId);
                return <ActivityRow key={r.activityId} name={a.name} color={a.color} stat={r} actual={r.actual} />;
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => setComparing(true)}
          className="mt-2.5 flex w-full items-center gap-3 rounded-[16px] border border-fg/[0.08] px-4 py-3 text-left hover:bg-fg/[0.03]"
        >
          <HistoryIcon size={18} className="shrink-0 text-fg/80" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-medium">Side by side with the {UNIT[kind]} before</span>
            <span className="block text-[11px] text-fg/50">Planned &amp; logged for two {UNIT[kind]}s</span>
          </span>
          <ChevronRight size={14} className="text-fg/35" />
        </button>
      </div>

      {comparing && (
        <CompareSheet
          kind={kind}
          cur={cur}
          prev={prev}
          curLabel={periodLabel(kind, start)}
          prevLabel={periodLabel(kind, prevStart)}
          onClose={() => setComparing(false)}
        />
      )}
    </div>
  );
}

/** Activities in their user order; "Other" is always last. */
function orderRows(rows: ActivityStat[], activities: { id: string; order: number }[]) {
  const ord = (id: string) => activities.find((a) => a.id === id)?.order ?? 999;
  return [...rows].sort((a, b) => ord(a.activityId) - ord(b.activityId));
}


/** On-time rate per bucket as a stem with a dot on top; buckets with nothing planned show only the baseline. */
function BarChart({ buckets }: { buckets: ReviewStats["buckets"] }) {
  const H = 80;
  return (
    <div className="mt-3 flex gap-[5px]">
      {buckets.map((b, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center">
          <div className="relative w-full" style={{ height: H + 18 }}>
            {b.sync !== null && (
              <div className="absolute inset-x-0 bottom-0 flex flex-col items-center" style={{ height: Math.max(8, Math.min(1, b.sync) * H) + 18 }}>
                <span className="text-[9.5px] font-medium text-fg/60 tabular">{fmtPct(b.sync)}</span>
                <span className="mt-[3px] h-[9px] w-[9px] shrink-0 rounded-full bg-fg" />
                <span className="w-[3px] flex-1 rounded-b-[1px] bg-fg/25" />
              </div>
            )}
          </div>
          <div className="h-px w-full bg-fg/[0.14]" />
          <span className="mt-1.5 text-[9.5px] font-medium uppercase text-fg/45">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function CompareSheet({
  kind,
  cur,
  prev,
  curLabel,
  prevLabel,
  onClose,
}: {
  kind: PeriodKind;
  cur: ReviewStats;
  prev: ReviewStats;
  curLabel: string;
  prevLabel: string;
  onClose: () => void;
}) {
  const activities = useSync((s) => s.activities);
  const ids = orderRows(
    [...cur.activities, ...prev.activities.filter((p) => !cur.activities.some((c) => c.activityId === p.activityId))],
    activities,
  ).map((r) => r.activityId);
  const find = (s: ReviewStats, id: string) => s.activities.find((a) => a.activityId === id);

  return (
    <Sheet title={`Two ${UNIT[kind]}s`} cancelLabel="Close" onCancel={onClose}>
      <div className="grid grid-cols-[1fr_1fr_1fr] px-1 pb-2 text-[11px] text-fg/50">
        <span />
        <span className="text-right tabular">{prevLabel}</span>
        <span className="text-right tabular">{curLabel}</span>
      </div>
      <div className="overflow-hidden rounded-[14px] bg-surface-2">
        <CompareRow label="On time" a={fmtPct(prev.sync)} b={fmtPct(cur.sync)} />
        <CompareRow label="Done" a={fmtPct(prev.attainment)} b={fmtPct(cur.attainment)} />
        <CompareRow label="Planned" a={fmtDuration(prev.planned)} b={fmtDuration(cur.planned)} />
        <CompareRow label="Logged" a={fmtDuration(prev.actual)} b={fmtDuration(cur.actual)} />
        <CompareRow label="Days with a plan" a={`${prev.daysWithPlan}/${prev.totalDays}`} b={`${cur.daysWithPlan}/${cur.totalDays}`} />
      </div>

      {ids.length > 0 && <h3 className="mb-1.5 mt-6 px-1 text-[13px] text-fg/50">By activity · logged / planned</h3>}
      <div className="flex flex-col gap-3">
        {ids.map((id) => {
          const act = activityOf(activities, id);
          const p = find(prev, id);
          const c = find(cur, id);
          const rate = (s?: ActivityStat) => (s && s.planned ? fmtPct(s.matched / s.planned) : "—");
          const att = (s?: ActivityStat) => (s && s.planned ? fmtPct((s.matched + s.elsewhere) / s.planned) : "—");
          const time = (s?: ActivityStat) => `${fmtDuration(s?.actual ?? 0)} / ${fmtDuration(s?.planned ?? 0)}`;
          return (
            <div key={id} className="overflow-hidden rounded-[14px] bg-surface-2">
              <div className="flex items-center gap-2 border-b border-fg/[0.08] px-4 py-2.5 text-[15px] font-medium">
                <span className="h-2 w-2 rounded-full" style={{ background: act.color }} />
                {act.name}
              </div>
              <CompareRow label="Time" a={time(p)} b={time(c)} />
              <CompareRow label="On time" a={rate(p)} b={rate(c)} />
              <CompareRow label="Done" a={att(p)} b={att(c)} />
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function CompareRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <div className="grid min-h-[40px] grid-cols-[1fr_1fr_1fr] items-center border-b border-fg/[0.08] px-4 text-[13.5px] last:border-b-0">
      <span className="text-fg/70">{label}</span>
      <span className="text-right text-fg/55 tabular">{a}</span>
      <span className="text-right font-medium tabular">{b}</span>
    </div>
  );
}
