"use client";

import { useEffect, useRef, useState } from "react";
import { useSync } from "@/lib/store";
import { isSameDay } from "@/lib/time";
import { cx } from "../ui";

/** A short note for one day; saves as you type (after a short pause) and when you leave the field. */
export function DiaryBox({ date, className, autoFocus }: { date: number; className?: string; autoFocus?: boolean }) {
  const saved = useSync((s) => (s.diary ?? []).find((x) => isSameDay(x.date, date))?.text ?? "");
  const setDiary = useSync((s) => s.setDiary);
  const [text, setText] = useState(saved);
  const [editing, setEditing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // follow edits from other devices while not typing here
  const shown = editing ? text : saved;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (v !== saved) setDiary(date, v);
  };

  return (
    <textarea
      data-diary
      aria-label="Diary"
      autoFocus={autoFocus}
      value={shown}
      placeholder="A note for the day…"
      onFocus={() => {
        setText(saved);
        setEditing(true);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(v), 600);
      }}
      onBlur={() => {
        flush(text);
        setEditing(false);
      }}
      rows={3}
      className={cx(
        "field-sizing-content min-h-[76px] w-full resize-none rounded-[12px] bg-surface px-3 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-fg/30",
        className,
      )}
    />
  );
}
