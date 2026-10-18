"use client";

import { useState } from "react";
import type { Todo } from "@/lib/types";
import { activityOf, useSync } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { useNow } from "@/lib/hooks";
import { logicalDate } from "@/lib/time";
import { CheckIcon } from "../icons";
import { TabHeader } from "../period";
import { cx } from "../ui";
import { TicketSheet } from "../tickets/TicketSheet";
import { projectColor, useTicketMeta } from "../tickets/ticket-ui";
import { ProjectFolders } from "./ProjectFolders";
import { ProjectSheet } from "./ProjectSheet";

/** The Projects tab (phones, and the side rail on computers): the folders, and my own # projects. */
export function ProjectsView() {
  const now = useNow(60_000);
  const dayStart = useSync((s) => s.settings.dayStart);
  const [ticket, setTicket] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ id: string | null } | null>(null);
  return (
    <div className="flex h-full flex-col pt-[max(8px,env(safe-area-inset-top))]">
      <TabHeader title="Projects" />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--tabbar-h)+48px)] pt-2">
        <ProjectFolders
          date={logicalDate(now, dayStart)}
          now={now}
          showTask={() => true}
          renderTask={(t) => <TaskLine key={t.id} t={t} />}
          onOpenTicket={setTicket}
          onEdit={(id) => setSheet({ id })}
          label={false}
          manage
        />
        <MyTags />
      </div>
      {ticket && <TicketSheet id={ticket} onClose={() => setTicket(null)} />}
      {sheet && <ProjectSheet id={sheet.id} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** A task in a folder: check it, or tap to open it. */
function TaskLine({ t }: { t: Todo }) {
  const { activities, toggleTodo } = useSync();
  const openEntry = useUI((s) => s.openEntry);
  const act = activityOf(activities, t.activityId);
  const color = t.color || act.color;
  return (
    <div data-task={t.id} className="flex items-center gap-3 rounded-[12px] border border-fg/[0.07] bg-surface px-3.5 py-2.5">
      <button
        aria-label={t.done ? "Mark not done" : "Mark done"}
        onClick={() => toggleTodo(t.id)}
        className={cx("flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-[1.5px]", t.done ? "border-transparent text-bg" : "border-fg/35")}
        style={t.done ? { background: color } : undefined}
      >
        {t.done && <CheckIcon size={12} />}
      </button>
      <button onClick={() => openEntry({ mode: "edit", kind: "todo", id: t.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className={cx("min-w-0 flex-1 truncate text-[14px]", t.done && "text-fg/40 line-through")}>{t.name}</span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-fg/45 tabular">
          {t.note?.trim() && <span>✎</span>}
          {t.date !== undefined && (
            <span>
              {new Date(t.date).getMonth() + 1}/{new Date(t.date).getDate()}
            </span>
          )}
          <span className="h-[6px] w-[6px] rounded-full" style={{ background: color }} />
        </span>
      </button>
    </div>
  );
}

/** My own # projects (Ote only): rename, or delete (their tickets are hidden). */
function MyTags() {
  const { renameLocalProject, deleteLocalProject } = useSync();
  const local = useSync((s) => s.settings.localProjects) ?? [];
  const tickets = useSync((s) => s.tickets ?? []);
  const meta = useTicketMeta();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  if (!local.length) return null;
  return (
    <section data-my-tags className="mt-8">
      <h2 className="mb-2 px-1 text-[13px] text-fg/60"># Projects</h2>
      <div className="overflow-hidden rounded-[14px] bg-surface">
        {local.map((p) => {
          const n = tickets.filter((t) => t.projectId === p.id && !t.hidden).length;
          return (
            <div key={p.id} data-my-tag={p.id} className="flex min-h-[46px] items-center gap-2 border-b border-fg/[0.07] px-4 last:border-b-0">
              <span style={{ color: projectColor(meta, p.id) }}>#</span>
              {editing === p.id ? (
                <input
                  autoFocus
                  aria-label={`Rename ${p.name}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") e.currentTarget.blur();
                    else if (e.key === "Escape") setEditing(null);
                  }}
                  onBlur={() => {
                    if (editing === p.id) renameLocalProject(p.id, name);
                    setEditing(null);
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                />
              ) : (
                <button
                  onClick={() => {
                    setArmed(null);
                    setName(p.name);
                    setEditing(p.id);
                  }}
                  className="min-w-0 flex-1 truncate text-left text-[15px]"
                >
                  {p.name}
                </button>
              )}
              <span className="shrink-0 text-[12px] text-fg/45 tabular">{n}</span>
              {armed === p.id ? (
                <button
                  onClick={() => {
                    deleteLocalProject(p.id);
                    setArmed(null);
                  }}
                  className="h-[26px] shrink-0 rounded-full bg-[#ff453a] px-2.5 text-[12px] font-semibold text-white"
                >
                  Delete{n ? ` with ${n}` : ""}
                </button>
              ) : (
                <button aria-label={`Delete ${p.name}`} onClick={() => setArmed(p.id)} className="shrink-0 rounded-full px-2 text-[12px] text-fg/45 hover:text-danger-soft">
                  Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
