"use client";

import { useEffect, useRef, useState } from "react";
import { DRAG_STEP_MIN, roundToStep } from "@/lib/drag";
import { timeAtPoint } from "@/lib/grid";
import { MIN } from "@/lib/time";
import { usePressDrag } from "./gesture";
import type { GridGeometry } from "./useBlockDrag";

/**
 * Press and drag on empty grid space to select a time range (5-minute steps). The range follows
 * the pointer through the grid (row = hour, x = minutes). Releasing calls `onSelect`; a plain tap
 * is left to the column's click handler.
 */
export function useCreateDrag({ grid, onSelect }: { grid: GridGeometry; onSelect: (start: number, end: number) => void }) {
  const [range, setRange] = useState<[number, number] | null>(null);
  const rangeRef = useRef(range);
  const latest = useRef({ grid, onSelect });
  useEffect(() => {
    latest.current = { grid, onSelect };
  });
  const { begin, justDragged } = usePressDrag();

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    const column = e.currentTarget;
    const target = e.target as HTMLElement;
    if (target !== column && !target.dataset.empty) return; // only on empty space
    const at = (p: { x: number; y: number }) => {
      const { dayStart, rowH, rows } = latest.current.grid;
      return roundToStep(timeAtPoint(column, p.x, p.y, dayStart, rowH, rows));
    };
    let anchor = 0;
    begin(e, {
      onActivate: (p) => {
        anchor = at(p);
      },
      onUpdate: (p) => {
        const t = at(p);
        const step = DRAG_STEP_MIN * MIN;
        const r: [number, number] = t >= anchor ? [anchor, Math.max(t, anchor + step)] : [t, anchor];
        rangeRef.current = r;
        setRange(r);
      },
      onEnd: (commit) => {
        const r = rangeRef.current;
        rangeRef.current = null;
        setRange(null);
        if (commit && r) latest.current.onSelect(r[0], r[1]);
      },
    });
  }

  return { range, justDragged, onPointerDown };
}
