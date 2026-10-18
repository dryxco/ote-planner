"use client";

// Stat widgets shared by the Review tab and the day summary under Today.
import { fmtPct } from "@/lib/stats";
import { fmtDuration } from "@/lib/time";

/** A score as a ring in a small card: "On time", "Done". Empty ring and "—" while there's no score. */
export function ScoreCard({ label, value, prev, prevLabel }: { label: string; value: number | null; prev?: number | null; prevLabel?: string }) {
  const R = 22;
  const C = 2 * Math.PI * R;
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div data-score={label} className="flex min-w-0 flex-1 items-center gap-3 rounded-[16px] bg-surface px-3 py-3">
      <svg width={54} height={54} viewBox="0 0 54 54" className="shrink-0 -rotate-90">
        <circle cx={27} cy={27} r={R} fill="none" stroke="var(--ring-track)" strokeWidth={5} />
        {value !== null && v > 0 && (
          <circle cx={27} cy={27} r={R} fill="none" stroke="var(--fg)" strokeWidth={5} strokeDasharray={`${v * C} ${C}`} />
        )}
      </svg>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg/50">{label}</div>
        <div className="text-[24px] font-semibold leading-tight tracking-[-0.02em] tabular">{fmtPct(value)}</div>
        {prevLabel !== undefined && (
          <div className="truncate text-[10.5px] text-fg/45 tabular">
            {prevLabel} {fmtPct(prev ?? null)}
          </div>
        )}
      </div>
    </div>
  );
}

export function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}

/** One line per activity: swatch, name, "9h 50m of 7h 30m", and a thin matched / at-another-time track. */
export function ActivityRow({
  name,
  color,
  stat,
  actual,
  strong,
}: {
  name: string;
  color?: string;
  stat: { planned: number; matched: number; elsewhere: number };
  actual: number;
  /** The "All" row: a little heavier than the activities under it. */
  strong?: boolean;
}) {
  const matchedPct = stat.planned ? (stat.matched / stat.planned) * 100 : 0;
  const elsePct = stat.planned ? (stat.elsewhere / stat.planned) * 100 : 0;
  const fill = color ?? "var(--matched)";
  const mid = color ? `color-mix(in srgb, ${color} 45%, var(--surface))` : "var(--elsewhere)";
  return (
    <div data-activity-row={name} className="grid grid-cols-[10px_1fr_auto] items-center gap-x-2.5 gap-y-1.5">
      <span className="h-[10px] w-[10px] rounded-[3px]" style={{ background: color ?? "var(--fg)" }} />
      <span className={strong ? "text-[14.5px] font-semibold" : "truncate text-[14px]"}>{name}</span>
      <span className="text-[13px] tabular">
        <span className="font-semibold">{fmtDuration(actual)}</span>
        <span className="text-fg/45"> of {fmtDuration(stat.planned)}</span>
      </span>
      <div className={`col-start-2 col-end-4 flex overflow-hidden rounded-[2px] bg-[var(--ring-track)] ${strong ? "h-[6px]" : "h-[4px]"}`}>
        <div style={{ width: `${matchedPct}%`, background: fill }} />
        <div style={{ width: `${elsePct}%`, background: mid }} />
      </div>
    </div>
  );
}
