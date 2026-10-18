"use client";

// Stat widgets shared by the Review tab and the day summary under Today.
import { fmtPct } from "@/lib/stats";
import { fmtDuration } from "@/lib/time";

export function BigStat({ label, value, prev, prevLabel }: { label: string; value: number | null; prev?: number | null; prevLabel?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[13px] text-fg/60">{label}</span>
      <span className="text-[30px] font-semibold leading-tight tabular">{fmtPct(value)}</span>
      {prevLabel !== undefined && (
        <span className="mt-1 text-[10px] text-fg/45">
          {prevLabel} {fmtPct(prev ?? null)}
        </span>
      )}
    </div>
  );
}

export function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-[6px] w-[6px] rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/** "Work   9h 50m / 7h 30m" with matched / at-another-time segments over the planned track. */
export function ActivityBar({
  name,
  color,
  stat,
  actual,
}: {
  name: string;
  color?: string;
  stat: { planned: number; matched: number; elsewhere: number };
  actual: number;
}) {
  const matchedPct = stat.planned ? (stat.matched / stat.planned) * 100 : 0;
  const elsePct = stat.planned ? (stat.elsewhere / stat.planned) * 100 : 0;
  const fill = color ?? "var(--matched)";
  const mid = color ? `color-mix(in srgb, ${color} 55%, var(--surface))` : "var(--elsewhere)";
  const track = color ? `color-mix(in srgb, ${color} 28%, var(--track))` : "var(--surface-2)";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[14px]">
        <span>{name}</span>
        <span className="tabular">
          <span className="font-semibold">{fmtDuration(actual)}</span>
          <span className="text-fg/55"> / {fmtDuration(stat.planned)}</span>
        </span>
      </div>
      <div className="flex h-[10px] overflow-hidden rounded-full" style={{ background: track }}>
        <div style={{ width: `${matchedPct}%`, background: fill }} />
        <div style={{ width: `${elsePct}%`, background: mid }} />
      </div>
    </div>
  );
}
