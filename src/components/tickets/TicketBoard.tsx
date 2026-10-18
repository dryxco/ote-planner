"use client";

import { useEffect, useRef, useState } from "react";
import type { Ticket } from "@/lib/types";
import { useSync } from "@/lib/store";
import { cx } from "../ui";
import { DEFAULT_STATUS, ProjectTag, StatusChip, loadTicketDetail, useTicketMeta } from "./ticket-ui";
import { CheckIcon, CopyIcon, TrashIcon } from "../icons";
import { TICKET_DRAG_TYPE, setDraggingTicket } from "../today/Timeline";
import { TicketCopyMenu } from "./ticket-copy";

// the same drag moves a card between columns, or onto the timeline (like a task)
const DRAG_TYPE = TICKET_DRAG_TYPE;
// priority chips (other names get a neutral one)
const PRIORITY: Record<string, string> = { Urgent: "#e98b8b", High: "#e9a2b4", Medium: "#f2d38a", Low: "#b9d4ee" };

/**
 * My tickets as a kanban board, one column per status (Not started / In progress / In review / Done, plus Backlog
 * when something is there). Open ones show every day; Done and Backlog only what got there on the
 * shown day. Drag a card to another column to change its status.
 */
export function TicketBoard({ tickets, dayStart, dayEnd, onOpen }: { tickets: Ticket[]; dayStart: number; dayEnd: number; onOpen: (id: string) => void }) {
  const meta = useTicketMeta();
  const updateTicket = useSync((s) => s.updateTicket);
  const boardRef = useRef<HTMLDivElement>(null);
  usePanWithMiddleButton(boardRef);
  const [over, setOver] = useState<string | null>(null);
  const onDay = (ms: number | null | undefined) => !!ms && ms >= dayStart && ms < dayEnd;
  const shown = tickets.filter((t) => {
    if (t.hidden) return false;
    if (t.statusGroup === "complete") return onDay(t.completedAt ?? t.statusSince);
    if (t.statusGroup === "backlog") return onDay(t.statusSince);
    return true;
  });
  // no backlog column (it's the board's parking lot, not today's work)
  const columns = (meta?.options.status.length ? meta.options.status : DEFAULT_STATUS).filter((c) => c.group !== "backlog");
  const move = (id: string, to: (typeof columns)[number]) => {
    const t = tickets.find((x) => x.id === id);
    if (!t || t.status === to.name) return;
    updateTicket(id, { status: to.name, statusGroup: to.group, statusColor: to.color });
  };

  if (!tickets.some((t) => !t.hidden)) {
    return (
      <p className="py-6 text-center text-[13px] text-fg/35">
        No tickets assigned to you. Type <span className="rounded bg-fg/[0.08] px-1">#</span> in the box above to file one on a project.
      </p>
    );
  }
  return (
    // columns share the width (empty ones stay narrow); past that the board scrolls sideways, with a fade
    <div className="relative mt-5 flex min-h-0 flex-1">
    <div ref={boardRef} data-ticket-board className="no-scrollbar flex min-h-0 flex-1 gap-2.5 overflow-x-auto pb-4 pr-6">
      {columns.map((c) => {
        const list = shown
          .filter((t) => t.status === c.name || (!columns.some((x) => x.name === t.status) && (t.statusGroup ?? "to_do") === c.group && columns.find((x) => x.group === c.group) === c))
          .sort((a, b) => (c.group === "complete" ? (b.completedAt ?? 0) - (a.completedAt ?? 0) : b.createdAt - a.createdAt));
        return (
          <section
            key={c.name}
            data-ticket-column={c.name}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              setOver(c.name);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === c.name ? null : o));
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(DRAG_TYPE);
              setOver(null);
              if (id) move(id, c);
            }}
            className={cx(
              "flex min-h-0 flex-col rounded-[12px] transition-colors",
              list.length ? "min-w-[188px] flex-[1_0_188px]" : "w-[112px] flex-none",
              over === c.name && "bg-[#4f5bd5]/[0.06] outline-2 -outline-offset-2 outline-dashed outline-[#4f5bd5]/40",
            )}
          >
            <header className="flex items-center gap-2 px-1 pb-2">
              <StatusChip name={c.name} color={c.color} group={c.group} className="text-[13px]" />
              <span data-column-count className="text-[13px] text-fg/45 tabular">
                {list.length}
              </span>
            </header>
            <div className="no-scrollbar flex min-h-[60px] flex-col gap-2 overflow-y-auto">
              {list.map((t) => (
                <Card key={t.id} t={t} meta={meta} onOpen={() => onOpen(t.id)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
    <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-bg to-transparent" />
    </div>
  );
}

function Card({ t, meta, onOpen }: { t: Ticket; meta: ReturnType<typeof useTicketMeta>; onOpen: () => void }) {
  const hideTicket = useSync((s) => s.hideTicket);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const done = t.statusGroup === "complete";
  return (
    <div
      data-ticket={t.id}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, t.id);
        e.dataTransfer.effectAllowed = "move";
        setDraggingTicket(t.id);
      }}
      onDragEnd={() => setDraggingTicket(null)}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      onMouseLeave={() => setConfirm(false)}
      onMouseEnter={() => t.databaseId && t.rowId && void loadTicketDetail(t.databaseId, t.rowId).catch(() => {})}
      className="group relative cursor-pointer rounded-[10px] border border-fg/[0.07] bg-surface px-3 py-2 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-fg/[0.14]"
    >
      <p className={cx("line-clamp-3 text-[13.5px] leading-snug", done && "text-fg/45 line-through")}>{t.title || "Untitled"}</p>
      {/* the assignee is always me here, so it isn't shown; priority, project and due share one line */}
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-fg/45">
        {t.priority && (
          <span className="shrink-0 rounded-[5px] px-1.5 py-[1px] text-[11px] text-fg/80" style={{ background: `color-mix(in srgb, ${PRIORITY[t.priority] ?? "#cfcfcf"} 55%, transparent)` }}>
            {t.priority}
          </span>
        )}
        <ProjectTag id={t.projectId} name={t.projectName} meta={meta} className="min-w-0 text-[11px]" />
        {t.due && <span className="shrink-0">due {Number(t.due.slice(5, 7))}/{Number(t.due.slice(8, 10))}</span>}
        {!t.rowId && !t.local && <span className="shrink-0">uploading…</span>}
      </div>
      {/* copy title / delete (hide in Sync), on hover */}
      <div className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 has-[[data-ticket-copy-menu]]:flex rounded-[10px] border border-fg/10 bg-surface p-0.5 shadow-sm group-hover:flex">
        <TicketCopyMenu t={t} place="below">
        <button
          aria-label="Copy title"
          title={copied ? "Copied" : "Copy title · right-click: ticket ID · work instruction"}
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard?.writeText(t.title).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1000);
            });
          }}
          className="flex h-7 w-7 items-center justify-center rounded-[8px] text-fg/60 hover:bg-fg/[0.06]"
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={15} />}
        </button>
        </TicketCopyMenu>
        <button
          aria-label={confirm ? "Tap again to delete" : "Delete ticket"}
          title="Removes it in Sync only (it stays on the connected service)"
          onClick={(e) => {
            e.stopPropagation();
            if (!confirm) return setConfirm(true);
            hideTicket(t.id);
          }}
          className={cx("flex h-7 items-center justify-center rounded-[8px] px-1.5 text-[12px]", confirm ? "bg-[#d9534f] text-white hover:bg-[#c84541]" : "text-[#d9534f] hover:bg-fg/[0.06]")}
        >
          {confirm ? "Delete" : <TrashIcon size={15} />}
        </button>
      </div>
    </div>
  );
}

/**
 * Middle mouse button pans the board sideways: hold it and move, or click it once and move away from
 * that spot to scroll (faster the farther you go) until the next click — like a browser's autoscroll,
 * which macOS browsers don't have.
 */
function usePanWithMiddleButton(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let anchorX = 0;
    let lastX = 0;
    let moved = false;
    let holding = false;
    let auto = false;
    let speed = 0;
    let raf = 0;
    const tick = () => {
      el.scrollLeft += speed;
      raf = requestAnimationFrame(tick);
    };
    const stopAuto = () => {
      auto = false;
      speed = 0;
      cancelAnimationFrame(raf);
      el.style.cursor = "";
    };
    // any click (anywhere) ends autoscroll, and isn't also taken as a click on what's under it
    const onAnyDown = (e: MouseEvent) => {
      if (!auto) return;
      e.preventDefault();
      e.stopPropagation();
      stopAuto();
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1 || auto) return;
      e.preventDefault(); // no paste / no browser autoscroll
      holding = true;
      moved = false;
      anchorX = lastX = e.clientX;
      el.style.cursor = "grabbing";
    };
    const onMove = (e: MouseEvent) => {
      if (holding) {
        if (Math.abs(e.clientX - anchorX) > 3) moved = true;
        el.scrollLeft -= e.clientX - lastX;
        lastX = e.clientX;
      } else if (auto) {
        const d = e.clientX - anchorX;
        speed = Math.abs(d) < 8 ? 0 : (d - Math.sign(d) * 8) / 6;
      }
    };
    const onUp = (e: MouseEvent) => {
      if (!holding || e.button !== 1) return;
      holding = false;
      if (moved) {
        el.style.cursor = "";
        return;
      }
      // a click without moving: autoscroll until the next click
      auto = true;
      el.style.cursor = "ew-resize";
      raf = requestAnimationFrame(tick);
    };
    const onAux = (e: MouseEvent) => e.button === 1 && e.preventDefault(); // no middle-click "open in new tab"
    window.addEventListener("mousedown", onAnyDown, true);
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("auxclick", onAux);
    window.addEventListener("blur", stopAuto);
    return () => {
      stopAuto();
      window.removeEventListener("mousedown", onAnyDown, true);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("auxclick", onAux);
      window.removeEventListener("blur", stopAuto);
    };
  }, [ref]);
}
