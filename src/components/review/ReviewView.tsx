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
import { ActivityBar, BigStat, Legend } from "@/components/stats-ui";

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
        <div className="flex justify-center gap-12 pb-2 pt-1">
          <BigStat label="On time" value={cur.sync} prev={prev.sync} prevLabel={PREV_LABEL[kind]} />
          <BigStat label="Attainment" value={cur.attainment} prev={prev.attainment} prevLabel={PREV_LABEL[kind]} />
        </div>

        <h3 className="mt-5 text-[13px] text-fg/50">{CHART_TITLE[kind]}</h3>
        <BarChart buckets={cur.buckets} />

        <div className="mt-7 flex items-center justify-between text-[14px]">
          <span className="text-fg/55">Days with a plan</span>
          <span className="font-semibold tabular">
            {cur.daysWithPlan}/{cur.totalDays}
          </span>
        </div>
        <div className="mt-3 h-px bg-fg/[0.08]" />

        <div className="mt-4">
          <ActivityBar name="All" stat={cur} actual={cur.actual} />
          <div className="mt-2 flex gap-3 text-[10px] text-fg/50">
            <Legend color="var(--matched)" label="Matched plan" />
            <Legend color="var(--elsewhere)" label="At another time" />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-5">
          {rows.map((r) => {
            const a = activityOf(activities, r.activityId);
            return <ActivityBar key={r.activityId} name={a.name} color={a.color} stat={r} actual={r.actual} />;
          })}
        </div>

        <button
          onClick={() => setComparing(true)}
          className="mt-7 flex w-full items-center gap-3 rounded-[14px] bg-surface px-4 py-3 text-left"
        >
          <HistoryIcon size={18} className="shrink-0 text-fg/80" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-medium">Side by side with the {UNIT[kind]} before</span>
            <span className="block text-[11px] text-fg/50">Plan &amp; actual for two {UNIT[kind]}s</span>
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


function BarChart({ buckets }: { buckets: ReviewStats["buckets"] }) {
  const H = 84;
  return (
    <div className="mt-2 flex gap-[5px]">
      {buckets.map((b, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center">
          <div className="flex w-full flex-col items-center justify-end" style={{ height: H + 16 }}>
            {b.sync !== null && (
              <>
                <span className="mb-1 text-[9px] text-fg/55 tabular">{fmtPct(b.sync)}</span>
                <div className="w-full bg-[#8e8e8e]" style={{ height: Math.max(2, Math.min(1, b.sync) * H) }} />
              </>
            )}
          </div>
          <div className="h-px w-full bg-fg/[0.14]" />
          <span className="mt-1.5 text-[9.5px] text-fg/45">{b.label}</span>
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
        <CompareRow label="Attainment" a={fmtPct(prev.attainment)} b={fmtPct(cur.attainment)} />
        <CompareRow label="Planned" a={fmtDuration(prev.planned)} b={fmtDuration(cur.planned)} />
        <CompareRow label="Actual" a={fmtDuration(prev.actual)} b={fmtDuration(cur.actual)} />
        <CompareRow label="Days with a plan" a={`${prev.daysWithPlan}/${prev.totalDays}`} b={`${cur.daysWithPlan}/${cur.totalDays}`} />
      </div>

      {ids.length > 0 && <h3 className="mb-1.5 mt-6 px-1 text-[13px] text-fg/50">By activity · actual / planned</h3>}
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
              <CompareRow label="Attainment" a={att(p)} b={att(c)} />
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
