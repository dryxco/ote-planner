"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
export const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * Desktop time picker in the app's own style (the browser's native one looks out of place):
 * a pill that opens hour / minute / AM-PM columns. Value is minutes after midnight.
 */
export function TimePicker({
  value,
  onChange,
  step = 5,
  label,
  className,
}: {
  value: number;
  onChange: (minutes: number) => void;
  step?: number;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // rendered in <body> (sheet groups clip overflow), under the pill, kept on screen
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const h24 = Math.floor(value / 60) % 24;
  const min = value % 60;
  const pm = h24 >= 12;
  const h12 = h24 % 12 || 12;
  const set = (h: number, m: number, isPm: boolean) => onChange(((h % 12) + (isPm ? 12 : 0)) * 60 + m);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    // bring the selected values into view (within their columns only)
    requestAnimationFrame(() =>
      pop.current?.querySelectorAll<HTMLElement>("[data-selected]").forEach((el) => {
        const list = el.parentElement!;
        list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
      }),
    );
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const minutes = Array.from({ length: 60 / step }, (_, i) => i * step);
  if (!minutes.includes(min)) minutes.push(min); // keep an off-step value visible
  minutes.sort((a, b) => a - b);

  const col = (items: { key: string; label: string; selected: boolean; pick: () => void }[], aria: string) => (
    <div role="listbox" aria-label={aria} className="no-scrollbar relative flex max-h-[216px] w-[52px] flex-col gap-0.5 overflow-y-auto py-1">
      {items.map((it) => (
        <button
          key={it.key}
          role="option"
          aria-selected={it.selected}
          {...(it.selected ? { "data-selected": "" } : {})}
          onClick={it.pick}
          className={cx(
            "h-[30px] shrink-0 rounded-[8px] text-[14px] tabular",
            it.selected ? "bg-fg/[0.1] font-semibold text-fg" : "text-fg/70 hover:bg-fg/[0.05]",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const below = r.bottom + 6 + 240 < window.innerHeight;
          setPos({ top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - 240), right: Math.max(8, window.innerWidth - r.right) });
          setOpen((v) => !v);
        }}
        className={cx("pill-input tabular", className)}
      >
        {fmtMinutes(value)}
      </button>
      {open && pos && createPortal(
        <div
          ref={pop}
          data-time-picker
          style={{ top: pos.top, right: pos.right }}
          className="animate-fade fixed z-[80] flex gap-1 rounded-[12px] border border-fg/10 bg-surface p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
        >
          {col(
            Array.from({ length: 12 }, (_, i) => i + 1).map((h) => ({ key: `h${h}`, label: String(h), selected: h === h12, pick: () => set(h, min, pm) })),
            "Hour",
          )}
          {col(
            minutes.map((m) => ({ key: `m${m}`, label: pad(m), selected: m === min, pick: () => set(h12, m, pm) })),
            "Minute",
          )}
          {col(
            [
              { key: "am", label: "AM", selected: !pm, pick: () => set(h12, min, false) },
              { key: "pm", label: "PM", selected: pm, pick: () => set(h12, min, true) },
            ],
            "AM/PM",
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
