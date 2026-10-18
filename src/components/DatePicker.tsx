"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./ui";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Desktop date picker in the app's own style (the browser's native one looks out of place): a pill
 * that opens a month grid. `value` / `onChange` are local-midnight ms.
 */
export function DatePicker({
  value,
  onChange,
  label,
  text,
  weekStartsOn = 0,
  className,
}: {
  value: number;
  onChange: (day: number) => void;
  label?: string;
  /** what the pill shows (defaults to "Oct 8, 2026") */
  text?: string;
  weekStartsOn?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const m = new Date(month);
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => new Date(m.getFullYear(), m.getMonth(), 1 - lead + i).getTime());
  const [today] = useState(() => startOfDay(Date.now()));
  const sel = startOfDay(value);
  const step = (n: number) => setMonth(new Date(m.getFullYear(), m.getMonth() + n, 1).getTime());
  const pick = (d: number) => {
    onChange(d);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const below = r.bottom + 6 + 300 < window.innerHeight;
          setPos({ top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - 300), right: Math.max(8, window.innerWidth - r.right) });
          const d = new Date(value);
          setMonth(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
          setOpen((v) => !v);
        }}
        className={cx("pill-input tabular", className)}
      >
        {text ?? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={pop}
            data-date-picker
            style={{ top: pos.top, right: pos.right }}
            className="animate-fade fixed z-[80] w-[252px] rounded-[12px] border border-fg/10 bg-surface p-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[14px] font-semibold">{m.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
              <span className="flex gap-1">
                <button aria-label="Previous month" onClick={() => step(-1)} className="h-[26px] w-[26px] rounded-[7px] text-fg/60 hover:bg-fg/[0.06]">
                  ‹
                </button>
                <button aria-label="Next month" onClick={() => step(1)} className="h-[26px] w-[26px] rounded-[7px] text-fg/60 hover:bg-fg/[0.06]">
                  ›
                </button>
              </span>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] text-fg/40">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} className="py-1">
                  {WEEK[(weekStartsOn + i) % 7]}
                </span>
              ))}
            </div>
            <div role="grid" className="grid grid-cols-7 gap-0.5">
              {cells.map((d) => {
                const inMonth = new Date(d).getMonth() === m.getMonth();
                return (
                  <button
                    key={d}
                    role="gridcell"
                    aria-selected={d === sel}
                    aria-label={new Date(d).toDateString()}
                    onClick={() => pick(d)}
                    className={cx(
                      "h-[30px] rounded-[8px] text-[13px] tabular",
                      d === sel ? "bg-fg/80 font-semibold text-bg" : d === today ? "font-semibold text-link hover:bg-fg/[0.06]" : "hover:bg-fg/[0.06]",
                      !inMonth && d !== sel && "text-fg/30",
                    )}
                  >
                    {new Date(d).getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-end px-1">
              <button onClick={() => pick(today)} className="text-[12.5px] text-link">
                Today
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
