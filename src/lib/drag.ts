import { MIN, floorTo } from "./time";

export type DragMode = "move" | "start" | "end";

export const DRAG_STEP_MIN = 5;

/** Round to the nearest `step`-minute mark on the local clock. */
export function roundToStep(t: number, step = DRAG_STEP_MIN): number {
  return floorTo(Math.round(t + (step * MIN) / 2), step);
}

/**
 * New [start, end] for a block dragged by `deltaMs`, snapped to 5-minute marks.
 * - move: keeps the duration, snaps the start
 * - start / end: resizes that edge, never shorter than one step
 * `maxEnd` caps the end (actuals can't run past now).
 */
export function applyDrag(
  mode: DragMode,
  origStart: number,
  origEnd: number,
  deltaMs: number,
  opts: { step?: number; maxEnd?: number } = {},
): [number, number] {
  const step = opts.step ?? DRAG_STEP_MIN;
  const minDur = step * MIN;
  const maxEnd = opts.maxEnd ?? Infinity;
  const dur = origEnd - origStart;

  if (mode === "move") {
    let start = roundToStep(origStart + deltaMs, step);
    if (start + dur > maxEnd) start = floorTo(maxEnd - dur, step);
    return [start, start + dur];
  }
  if (mode === "start") {
    const start = Math.min(roundToStep(origStart + deltaMs, step), origEnd - minDur);
    return [start, origEnd];
  }
  let end = Math.max(roundToStep(origEnd + deltaMs, step), origStart + minDur);
  if (end > maxEnd) end = Math.max(maxEnd, origStart + minDur);
  return [origStart, end];
}
