"use client";

import { useRef, useState, type ReactNode } from "react";
import { isPressDragActive, markDragged } from "./gesture";

const SNAP_MS = 240;

/**
 * Swipe the timeline left/right (touch) to go to the next / previous day. The page follows the
 * finger; on release it glides out and the new day slides in from the other side. Vertical scrolls,
 * long-press block moves and range selections are left alone (direction is decided after a few px).
 */
export function DaySwipe({ onDay, children }: { onDay: (delta: 1 | -1) => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const g = useRef<{ id: number; x: number; y: number; lastX: number; lastT: number; v: number; horizontal: boolean | null } | null>(null);
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const busy = useRef(false);

  function glide(dir: -1 | 0 | 1) {
    const w = box.current?.clientWidth ?? 0;
    busy.current = true;
    setAnim(true);
    setDx(-dir * w);
    window.setTimeout(() => {
      if (dir === 0) {
        setAnim(false);
        busy.current = false;
        return;
      }
      // switch the day while off-screen, then slide the new day in from the other side
      setAnim(false);
      setDx(dir * w);
      onDay(dir);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setAnim(true);
          setDx(0);
          window.setTimeout(() => {
            setAnim(false);
            busy.current = false;
          }, SNAP_MS);
        }),
      );
    }, SNAP_MS);
  }

  return (
    <div
      ref={box}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      onPointerDownCapture={(e) => {
        if (e.pointerType === "mouse" || busy.current || g.current) return; // mouse drags select ranges
        g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: e.timeStamp, v: 0, horizontal: null };
      }}
      onPointerMoveCapture={(e) => {
        const s = g.current;
        if (!s || e.pointerId !== s.id) return;
        if (isPressDragActive()) {
          // a long-press move/selection took over
          if (s.horizontal) glide(0);
          g.current = null;
          return;
        }
        const mx = e.clientX - s.x;
        const my = e.clientY - s.y;
        if (s.horizontal === null && Math.hypot(mx, my) > 10) s.horizontal = Math.abs(mx) > Math.abs(my) * 1.2;
        if (!s.horizontal) return;
        const dt = e.timeStamp - s.lastT;
        if (dt > 0) s.v = 0.7 * ((e.clientX - s.lastX) / dt) + 0.3 * s.v;
        s.lastX = e.clientX;
        s.lastT = e.timeStamp;
        setDx(mx);
      }}
      onPointerUpCapture={(e) => {
        const s = g.current;
        g.current = null;
        if (!s || e.pointerId !== s.id || !s.horizontal) return;
        markDragged(); // the click that follows must not open a sheet
        const w = box.current?.clientWidth ?? 1;
        const mx = e.clientX - s.x;
        const flick = e.timeStamp - s.lastT < 100 && Math.abs(s.v) > 0.4 && Math.sign(s.v) === Math.sign(mx);
        glide(Math.abs(mx) > w * 0.28 || flick ? (mx < 0 ? 1 : -1) : 0);
      }}
      onPointerCancelCapture={() => {
        if (g.current?.horizontal) glide(0);
        g.current = null;
      }}
    >
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: anim ? `transform ${SNAP_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1)` : "none",
          opacity: dx ? Math.max(0.55, 1 - Math.abs(dx) / 640) : 1,
        }}
      >
        {children}
      </div>
    </div>
  );
}
