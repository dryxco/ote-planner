"use client";

import type { ReactNode } from "react";
import type { PeriodKind } from "@/lib/stats";
import { ChevronLeft, ChevronRight } from "./icons";
import { cx } from "./ui";

export const PERIOD_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

/** Tab title, set to the left like the Today header. */
export function TabHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between gap-3 px-4">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{title}</h1>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}

/** "label  ‹ ›" with Week / Month / Year as underlined words under it. */
export function PeriodBar({
  kind,
  onKind,
  label,
  sub,
  onPrev,
  onNext,
  onLabel,
}: {
  kind: PeriodKind;
  onKind: (k: PeriodKind) => void;
  label: string;
  sub?: string;
  onPrev: () => void;
  onNext: () => void;
  /** Tap on the label (jump back to the current period). */
  onLabel?: () => void;
}) {
  const step = "flex h-8 w-8 items-center justify-center rounded-[9px] border border-fg/[0.12] text-fg/80 hover:bg-fg/[0.06]";
  return (
    <div className="shrink-0 border-b border-fg/[0.08] px-4">
      <div role="tablist" className="flex gap-5">
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.value}
            role="tab"
            aria-selected={kind === o.value}
            onClick={() => onKind(o.value)}
            className={cx(
              "relative pb-1.5 text-[13.5px] transition-colors",
              kind === o.value ? "font-semibold text-fg" : "text-fg/45 hover:text-fg/75",
            )}
          >
            {o.label}
            {kind === o.value && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-now" />}
          </button>
        ))}
      </div>
      <div className="flex h-[54px] items-center justify-between gap-2">
        <button onClick={onLabel} className="flex min-w-0 flex-col items-start">
          <span className="text-[17px] font-semibold tabular">{label}</span>
          {sub && <span className="text-[10.5px] text-fg/50">{sub}</span>}
        </button>
        <div className="flex shrink-0 gap-1.5">
          <button aria-label="Previous" onClick={onPrev} className={step}>
            <ChevronLeft size={16} />
          </button>
          <button aria-label="Next" onClick={onNext} className={step}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
