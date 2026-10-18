"use client";

import { useEffect, useRef } from "react";

const LONG_PRESS_MS = 320;
const MOUSE_THRESHOLD_PX = 3;
const TOUCH_SLOP_PX = 8;
const EDGE_PX = 48;
const EDGE_SPEED = 7;

let lastDragEnd = 0;
let pressDragActive = false;
/** A block move / range selection is in progress (other gestures must stand down). */
export function isPressDragActive(): boolean {
  return pressDragActive;
}
/** Let other gestures (e.g. day swipe) suppress the click that follows them. */
export function markDragged() {
  lastDragEnd = Date.now();
}
/** True right after any Today-grid drag ended, so the click that follows it can be ignored. */
export function recentlyDragged(): boolean {
  return Date.now() - lastDragEnd < 100;
}

export interface GesturePoint {
  x: number;
  y: number;
}

interface Active {
  pointerId: number;
  start: GesturePoint;
  last: GesturePoint;
  active: boolean;
  scrollEl: HTMLElement | null;
  timer?: ReturnType<typeof setTimeout>;
  off: () => void;
  onUpdate: (p: GesturePoint) => void;
  onEnd: (commit: boolean) => void;
}

/**
 * Press-drag gesture shared by block dragging and range selection on the Today grid.
 * Mouse: activates after a few pixels. Touch: needs a long press (unless `immediate`), so a quick
 * swipe still scrolls the timeline. While active, page scrolling is blocked and the timeline
 * auto-scrolls when the pointer is pushed toward its top/bottom edge.
 */
export function usePressDrag() {
  const g = useRef<Active | null>(null);
  const edgeRaf = useRef<number | null>(null);
  const justDragged = useRef(false);

  function stopEdge() {
    if (edgeRaf.current !== null) cancelAnimationFrame(edgeRaf.current);
    edgeRaf.current = null;
  }

  function edgeScroll() {
    const a = g.current;
    if (!a?.active || !a.scrollEl) return stopEdge();
    const r = a.scrollEl.getBoundingClientRect();
    const y = a.last.y;
    const dir = y < r.top + EDGE_PX && y < a.start.y - 4 ? -1 : y > r.bottom - EDGE_PX && y > a.start.y + 4 ? 1 : 0;
    if (dir === 0) return stopEdge();
    a.scrollEl.scrollTop += dir * EDGE_SPEED;
    a.onUpdate(a.last);
    edgeRaf.current = requestAnimationFrame(edgeScroll);
  }

  function end(commit: boolean) {
    const a = g.current;
    g.current = null;
    stopEdge();
    if (!a) return;
    pressDragActive = false;
    a.off();
    clearTimeout(a.timer);
    if (!a.active) return;
    justDragged.current = true;
    lastDragEnd = Date.now();
    setTimeout(() => (justDragged.current = false), 0);
    a.onEnd(commit);
  }

  /**
   * Start tracking a pointer. `onActivate` runs when the drag really begins (returns false to abort).
   */
  function begin(
    e: React.PointerEvent<HTMLElement>,
    opts: {
      immediate?: boolean;
      onActivate: (start: GesturePoint) => void;
      onUpdate: (p: GesturePoint) => void;
      onEnd: (commit: boolean) => void;
    },
  ) {
    if (e.button !== 0 || g.current) return false;
    const pointerId = e.pointerId;
    const isMouse = e.pointerType === "mouse";
    const captureEl = (e.currentTarget.closest("[data-column]") as HTMLElement | null) ?? e.currentTarget;
    const a: Active = {
      pointerId,
      start: { x: e.clientX, y: e.clientY },
      last: { x: e.clientX, y: e.clientY },
      active: false,
      scrollEl: e.currentTarget.closest("[data-timeline-scroll]") as HTMLElement | null,
      off: () => {},
      onUpdate: opts.onUpdate,
      onEnd: opts.onEnd,
    };
    const activate = () => {
      if (g.current !== a || a.active) return;
      a.active = true;
      pressDragActive = true;
      // Keep receiving this pointer even if the element under it re-renders away (a block's row
      // segments are replaced as it moves); the column itself never unmounts.
      try {
        captureEl.setPointerCapture(pointerId);
      } catch {}
      if (navigator.vibrate) navigator.vibrate(8);
      opts.onActivate(a.start);
      opts.onUpdate(a.last);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || g.current !== a) return;
      a.last = { x: ev.clientX, y: ev.clientY };
      if (!a.active) {
        const d = Math.hypot(ev.clientX - a.start.x, ev.clientY - a.start.y);
        if (isMouse || opts.immediate) {
          if (d >= MOUSE_THRESHOLD_PX) activate();
        } else if (d > TOUCH_SLOP_PX) {
          end(false); // finger moved before the long press: it's a scroll
        }
        return;
      }
      a.onUpdate(a.last);
      if (edgeRaf.current === null) edgeRaf.current = requestAnimationFrame(edgeScroll);
    };
    const onUp = (ev: PointerEvent) => ev.pointerId === pointerId && end(true);
    const onCancel = (ev: PointerEvent) => ev.pointerId === pointerId && end(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    a.off = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    g.current = a;
    if (!isMouse && !opts.immediate) a.timer = setTimeout(activate, LONG_PRESS_MS);
    return true;
  }

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (g.current?.active) e.preventDefault();
    };
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      document.removeEventListener("touchmove", onTouchMove);
      end(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { begin, justDragged };
}
