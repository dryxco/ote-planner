"use client";

import { useEffect, useRef, useState } from "react";
import { applyDrag, type DragMode } from "@/lib/drag";
import { timeAtPoint } from "@/lib/grid";
import { usePressDrag } from "./gesture";

export interface GridGeometry {
  dayStart: number;
  rowH: number;
  rows: number;
}

/**
 * Drag a block on the Today grid: the body moves it, the start/end handles resize it.
 * The pointer's grid position maps to a time (row = hour, x = minutes), snapped to 5 minutes.
 */
export function useBlockDrag({
  start,
  end,
  grid,
  enabled,
  maxEnd,
  onCommit,
  onDropOnTasks,
  onDropOutside,
}: {
  start: number;
  end: number;
  grid: GridGeometry;
  enabled: boolean;
  /** Read at drag start; caps the end (e.g. now, for actuals). */
  maxEnd?: () => number | undefined;
  onCommit: (start: number, end: number) => void;
  /** Released over the task list ([data-task-drop]) instead of the grid: make it a task. */
  onDropOnTasks?: () => void;
  /** Released outside the timeline altogether: take it off (e.g. remove an actual). */
  onDropOutside?: () => void;
}) {
  const [preview, setPreview] = useState<{ mode: DragMode; start: number; end: number } | null>(null);
  const previewRef = useRef(preview);
  const latest = useRef({ start, end, grid, onCommit, onDropOnTasks, onDropOutside });
  useEffect(() => {
    latest.current = { start, end, grid, onCommit, onDropOnTasks, onDropOutside };
  });
  const [overTasks, setOverTasks] = useState(false);
  const { begin, justDragged } = usePressDrag();

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (!enabled) return;
    const mode = (e.currentTarget.dataset.dragHandle as DragMode | undefined) ?? "move";
    const column = e.currentTarget.closest("[data-column]") as HTMLElement | null;
    if (!column) return;
    e.stopPropagation(); // don't start a range selection on the column underneath
    const cap = maxEnd?.();
    let anchor = 0;
    let target: HTMLElement | null = null;
    const dropTarget = (p: { x: number; y: number }) => {
      if (mode !== "move") return null;
      const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
      if (latest.current.onDropOnTasks) return el?.closest("[data-task-drop]") as HTMLElement | null;
      // anywhere off the timeline counts as "out" (the task list included)
      if (latest.current.onDropOutside && !el?.closest("[data-timeline-scroll]")) return (el?.closest("[data-task-drop]") as HTMLElement | null) ?? document.body;
      return null;
    };
    const at = (p: { x: number; y: number }) => {
      const { dayStart, rowH, rows } = latest.current.grid;
      return timeAtPoint(column, p.x, p.y, dayStart, rowH, rows);
    };
    begin(e, {
      immediate: mode !== "move",
      onActivate: (p) => {
        anchor = at(p);
      },
      onUpdate: (p) => {
        const t = dropTarget(p);
        if (t !== target) {
          target?.removeAttribute("data-drop-over");
          t?.setAttribute("data-drop-over", "1");
          target = t;
          setOverTasks(!!t);
        }
        const { start: s, end: en } = latest.current;
        const [ns, ne] = applyDrag(mode, s, en, at(p) - anchor, { maxEnd: cap });
        previewRef.current = { mode, start: ns, end: ne };
        setPreview(previewRef.current);
      },
      onEnd: (commit) => {
        const p = previewRef.current;
        previewRef.current = null;
        setPreview(null);
        const dropped = target;
        target?.removeAttribute("data-drop-over");
        target = null;
        setOverTasks(false);
        if (commit && dropped) {
          if (latest.current.onDropOnTasks) latest.current.onDropOnTasks();
          else latest.current.onDropOutside?.();
          return;
        }
        if (commit && p && (p.start !== latest.current.start || p.end !== latest.current.end)) {
          latest.current.onCommit(p.start, p.end);
        }
      },
    });
  }

  return { preview, dragging: preview !== null, overTasks, justDragged, onPointerDown };
}
