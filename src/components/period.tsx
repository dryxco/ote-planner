"use client";

import type { ReactNode } from "react";
import type { PeriodKind } from "@/lib/stats";
import { ChevronLeft, ChevronRight } from "./icons";
import { Segmented } from "./ui";

export const PERIOD_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

/** Large centered tab title used by Review / Activities / Goals. */
export function TabHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="relative flex h-[52px] shrink-0 items-center justify-center px-4">
      <h1 className="text-[17px] font-semibold">{title}</h1>
      {right && <div className="absolute right-4 top-1/2 -translate-y-1/2">{right}</div>}
    </header>
  );
}

/** Week / Month / Year switch with "‹ label ›" navigation underneath. */
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
  return (
    <div className="shrink-0 border-b border-fg/[0.08]">
      <Segmented className="mx-4" value={kind} options={PERIOD_OPTIONS} onChange={onKind} />
      <div className="flex h-[52px] items-center justify-between px-3">
        <button aria-label="Previous" onClick={onPrev} className="flex h-9 w-9 items-center justify-center text-fg">
          <ChevronLeft size={20} />
        </button>
        <button onClick={onLabel} className="flex flex-col items-center">
          <span className="text-[16px] font-semibold tabular">{label}</span>
          {sub && <span className="text-[10.5px] text-fg/50">{sub}</span>}
        </button>
        <button aria-label="Next" onClick={onNext} className="flex h-9 w-9 items-center justify-center text-fg">
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}
