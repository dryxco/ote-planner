"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Ticket } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (ms: number | null | undefined) => {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A short id to name the ticket by (the connector's id, first 8 characters). */
export const ticketShortId = (t: Ticket) => (t.rowId ? t.rowId.slice(0, 8) : null);

/** The card's fields with a value (title and files left out). */
function fields(t: Ticket): [string, string][] {
  const out: [string, string][] = [
    ["Status", t.status],
    ["Assignee", (t.assignees ?? []).join(", ")],
    ["Author", t.author ?? ""],
    ["Priority", t.priority ?? ""],
    ["Estimate", t.estimate ?? ""],
    ["Due", t.due ?? ""],
    ["Created", stamp(t.createdAt)],
    ["Completed", stamp(t.completedAt)],
  ];
  return out.filter(([, v]) => v.trim());
}

/** A brief to paste into a coding agent: the ticket's card plus how to work it end to end. */
export function ticketInstruction(t: Ticket): string {
  const id = ticketShortId(t) ?? "";
  const title = t.title || "Untitled";
  return [
    `# Work Instruction — Ticket ${id ? `${id}: ` : ""}${title}`,
    "",
    "Execute this ticket end-to-end in this session: gather context, plan, do the work, verify, report.",
    "Pasting this instruction is the user's authorization for that scope — nothing beyond it.",
    "",
    "## Ticket summary (card fields)",
    ...fields(t).map(([n, v]) => `- ${n}: ${v}`),
    ...(t.note?.trim() ? ["", "## Description", t.note.trim()] : []),
    "",
    "## Step 1 — Full context before any change",
    "Read the full ticket (description, images, attachments, comments) where it lives — this card is only a summary.",
    "Then read the files or systems the ticket touches and follow existing patterns.",
    "If the ticket describes a bug, reproduce it before fixing.",
    "",
    "## Step 2 — Plan, then execute",
    "Move the ticket to an in-progress status before you start.",
    "For multi-step work, write a short plan (2-5 steps) before editing.",
    "Fix root causes, not symptoms.",
    "Keep the change minimal — nothing beyond what the ticket asks for; no unrequested refactors.",
    "",
    "## Step 3 — Verify (evidence, not assertions)",
    "Derive concrete completion criteria from the ticket and check each one.",
    "Run the relevant checks (build/lint/tests for code) and iterate until they pass.",
    "Capture proof (command output, screenshots) as you go.",
    "",
    "## Step 4 — Report and hand off",
    "Leave a comment on the ticket — what changed, how it was verified, links to deliverables, proof — and move it to review if there is such a status.",
    "Then summarize the same to the user, including remaining risks.",
    "Never move the ticket to done yourself — completion approval belongs to the user.",
  ].join("\n");
}

/**
 * Right-click the copy control (sheet's Copy / a card's copy icon) for "Copy ticket ID" · "Copy agent
 * work instruction". `place` puts the menu above (sheet footer) or below (card).
 */
export function TicketCopyMenu({ t, place, children }: { t: Ticket; place: "above" | "below"; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  // on the page's top layer, kept inside the window: inside a card it was cut off by the board's
  // scrolling column
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!open && !done) return;
    const a = ref.current?.getBoundingClientRect();
    const m = menuRef.current?.getBoundingClientRect();
    if (!a || !m) return;
    const left = Math.max(8, Math.min(place === "above" ? a.left : a.right - m.width, window.innerWidth - m.width - 8));
    const top = place === "above" ? a.top - m.height - 6 : a.bottom + 4;
    setPos({ left, top: Math.max(8, Math.min(top, window.innerHeight - m.height - 8)) });
  }, [open, done, place]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node) && setOpen(false);
    const shut = () => setOpen(false); // it doesn't follow its card
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", esc, true);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", esc, true);
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("resize", shut);
    };
  }, [open]);
  const id = ticketShortId(t);
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(msg);
      setTimeout(() => setDone(null), 1200);
    } catch {}
    setOpen(false);
  };
  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setPos({ visibility: "hidden" });
        setOpen((v) => !v);
      }}
    >
      {children}
      {open && createPortal(
        <span
          ref={menuRef}
          role="menu"
          data-ticket-copy-menu
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={pos}
          className="animate-fade fixed z-[200] flex w-max min-w-[190px] flex-col rounded-[12px] border border-fg/10 bg-surface p-1 shadow-2xl"
        >
          <button role="menuitem" disabled={!id} onClick={() => id && copy(id, "Ticket ID copied")} className="rounded-[8px] px-3 py-2 text-left text-[14px] hover:bg-fg/[0.06] disabled:opacity-40">
            Copy ticket ID
          </button>
          <button role="menuitem" onClick={() => copy(ticketInstruction(t), "Work instruction copied")} className="rounded-[8px] px-3 py-2 text-left text-[14px] hover:bg-fg/[0.06] disabled:opacity-40">
            Copy agent work instruction
          </button>
          {!id && !t.local && <span className="px-3 pb-1.5 text-[11.5px] text-fg/40">The ID comes once it&apos;s filed</span>}
        </span>,
        document.body,
      )}
      {done &&
        createPortal(
          <span ref={menuRef} style={pos} className="pointer-events-none fixed z-[200] whitespace-nowrap rounded-[8px] bg-fg px-2 py-1 text-[11.5px] text-bg">
            {done}
          </span>,
          document.body,
        )}
    </span>
  );
}
