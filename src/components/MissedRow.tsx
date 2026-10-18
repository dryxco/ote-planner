"use client";

import type { Todo } from "@/lib/types";
import { useUI } from "@/lib/ui";
import { cx } from "./ui";

/**
 * A to-do on a day it was planned for but not done (it rolled over to No date): struck through —
 * red with ✕ while it's still open, gray with → once it got done on a later day.
 */
export function MissedRow({ t, compact }: { t: Todo; compact?: boolean }) {
  const openEntry = useUI((s) => s.openEntry);
  const done = t.done;
  return (
    <button
      data-missed={t.id}
      onClick={() => openEntry({ mode: "edit", kind: "todo", id: t.id })}
      title={done ? "Done on a later day" : "Not done this day — moved to No date"}
      className={cx(
        "flex w-full items-center gap-3 text-left",
        compact ? "py-2 text-[13.5px]" : "rounded-[12px] border border-fg/[0.07] bg-surface px-3.5 py-2.5 text-[14px]",
      )}
    >
      <span
        aria-label={done ? "Moved and done later" : "Missed"}
        className={cx(
          "flex h-[20px] w-[20px] shrink-0 items-center justify-center text-[13px] font-semibold leading-none",
          done ? "text-fg/40" : "text-[#ff453a]",
        )}
      >
        {done ? "→" : "✕"}
      </span>
      <span
        className={cx(
          "min-w-0 flex-1 truncate line-through decoration-[1.5px]",
          done ? "text-fg/40 decoration-fg/40" : "text-[#ff453a]/80 decoration-[#ff453a]",
        )}
      >
        {t.name}
      </span>
    </button>
  );
}
