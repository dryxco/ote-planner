"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Campaign, Ticket, Todo } from "@/lib/types";
import { activityOf, openAndDone, useSync, withBranchesUnderMain } from "@/lib/store";
import { allDone, campaignItems, campaignProgress, campaignTime, dueLabel } from "@/lib/campaigns";
import { fmtDuration, isSameDay, startOfDay } from "@/lib/time";
import { ChevronRight, PlusIcon } from "../icons";
import { cx } from "../ui";
import { TODO_DRAG_TYPE, TICKET_DRAG_TYPE, getDraggingTodo, setDraggingTicket } from "../today/Timeline";
import { TicketRow, projectColor, useTicketMeta } from "../tickets/ticket-ui";

const OPEN_KEY = "sync-open-projects";
const FOLDED_KEY = "sync-projects-folded";

/** "@query" being typed at the end of the add box (the project picker's filter), or null. */
export function atQuery(text: string): string | null {
  const m = /(?:^|\s)@([^@\s][^@]*|)$/.exec(text);
  return m ? m[1] : null;
}

/** Open projects matching the query, then "Create @query" when none is called exactly that. */
export function campaignPickerItems(campaigns: Campaign[], query: string): { id: string | null; name: string }[] {
  const q = query.trim().toLowerCase();
  const list = campaigns
    .filter((c) => !c.done && c.name.toLowerCase().includes(q))
    .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity))
    .map((c) => ({ id: c.id as string | null, name: c.name }));
  if (q && !campaigns.some((c) => !c.done && c.name.trim().toLowerCase() === q)) list.push({ id: null, name: query.trim() });
  return list;
}

/** The "@" list under the add box. */
export function CampaignPicker({
  items,
  active,
  onHover,
  onPick,
}: {
  items: { id: string | null; name: string }[];
  active: number;
  onHover: (i: number) => void;
  onPick: (p: { id: string | null; name: string }) => void;
}) {
  if (!items.length) return null;
  return (
    <div data-campaign-picker role="listbox" className="animate-fade absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[320px] overflow-y-auto rounded-[12px] border border-fg/10 bg-surface py-1 shadow-2xl">
      {items.map((p, i) => (
        <button
          key={p.id ?? "new"}
          role="option"
          aria-selected={i === active}
          onMouseMove={() => i !== active && onHover(i)}
          onMouseDown={(e) => e.preventDefault()} // keep the input focused
          onClick={() => onPick(p)}
          className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13.5px] hover:bg-fg/[0.06]", i === active && "bg-[#4f5bd5]/[0.12] font-medium")}
        >
          {p.id ? <FolderGlyph /> : <span className="w-[14px] text-center text-fg/50">+</span>}
          <span className="truncate">{p.id ? p.name : <>Create @{p.name}</>}</span>
          {i === active && <span className="ml-auto text-[11px] text-fg/40">↵</span>}
        </button>
      ))}
    </div>
  );
}

/** A ticket in a task list: the ticket row (status chip first, so it reads apart from tasks), draggable. */
export function TicketItem({ t, onOpen }: { t: Ticket; onOpen: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TICKET_DRAG_TYPE, t.id);
        e.dataTransfer.effectAllowed = "move";
        setDraggingTicket(t.id); // onto the timeline too, like a board card
      }}
      onDragEnd={() => setDraggingTicket(null)}
    >
      <TicketRow t={t} onOpen={onOpen} />
    </div>
  );
}

/**
 * Projects as folders above the day's tasks: each holds its tasks and tickets (open first, then a
 * collapsed Done), with due date, progress and the time put in through its activities. Drop a task
 * or a ticket on a folder to put it in. Finished projects wait under their own heading.
 */
export function ProjectFolders({
  date,
  now,
  showTask,
  renderTask,
  onOpenTicket,
  onAddInto,
  onEdit,
  label = true,
  manage = false,
  onAddArtifact,
  renderArtifacts,
}: {
  /** "Projects" above the folders (left out where the page is already called that). */
  label?: boolean;
  /** The Projects tab: Complete / Reopen on each folder, and finished projects listed. Elsewhere (home) finished ones aren't shown. */
  manage?: boolean;
  date: number;
  now: number;
  /** The panel's filter (by activity) for the tasks inside. */
  showTask: (t: Todo) => boolean;
  renderTask: (t: Todo) => ReactNode;
  onOpenTicket: (id: string) => void;
  /** "+" on a folder: the panel's add box files into it. Without it (phones), "+" opens an add row in the folder. */
  onAddInto?: (c: Campaign) => void;
  onEdit: (id: string | null) => void;
  /** "+ Artifact" on each folder (the Projects tab on computers, where the canvas shows them). */
  onAddArtifact?: (c: Campaign) => void;
  /** A project's artifacts under its header (the Projects tab on phones). */
  renderArtifacts?: (c: Campaign, open: boolean) => ReactNode;
}) {
  const campaigns = useSync((s) => s.campaigns) ?? [];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showFinished, setShowFinished] = useState(false);
  // the whole section folds away (where it sits above the day's tasks)
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[]));
      setFolded(localStorage.getItem(FOLDED_KEY) === "1");
    } catch {}
  }, []);
  const fold = () =>
    setFolded((v) => {
      try {
        localStorage.setItem(FOLDED_KEY, v ? "0" : "1");
      } catch {}
      return !v;
    });
  const hidden = label && folded;
  const flip = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...n]));
      } catch {}
      return n;
    });
  const byDue = (a: Campaign, b: Campaign) => (a.due ?? Infinity) - (b.due ?? Infinity) || (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
  const active = campaigns.filter((c) => !c.done).sort(byDue);
  const finished = campaigns.filter((c) => c.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const folder = (c: Campaign) => (
    <Folder
      key={c.id}
      c={c}
      date={date}
      now={now}
      open={open.has(c.id)}
      onFlip={() => flip(c.id)}
      showTask={showTask}
      renderTask={renderTask}
      onOpenTicket={onOpenTicket}
      onAddInto={() => {
        if (!open.has(c.id)) flip(c.id);
        onAddInto?.(c);
      }}
      inlineAdd={!onAddInto}
      onEdit={() => onEdit(c.id)}
      manage={manage}
      onAddArtifact={onAddArtifact && (() => onAddArtifact(c))}
      artifacts={renderArtifacts?.(c, open.has(c.id))}
    />
  );

  return (
    <div data-projects className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1 text-[13px] text-fg/60">
        {label && (
          <button data-fold-projects onClick={fold} aria-expanded={!folded} className="flex items-center gap-2 text-left">
            <ChevronRight size={12} className={cx("transition-transform", !folded && "rotate-90")} />
            Projects
            {folded && <span className="tabular text-fg/40">{active.length}</span>}
          </button>
        )}
        <button data-new-project onClick={() => onEdit(null)} className="ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] text-link hover:bg-link/[0.08]">
          <PlusIcon size={12} />
          New project
        </button>
      </div>
      {!hidden && active.map(folder)}
      {!hidden && manage && finished.length > 0 && (
        <>
          <button onClick={() => setShowFinished((v) => !v)} className="flex items-center gap-2 px-1 text-left text-[12px] text-fg/50">
            <ChevronRight size={11} className={cx("transition-transform", showFinished && "rotate-90")} />
            Finished projects <span className="tabular">{finished.length}</span>
          </button>
          {showFinished && finished.map(folder)}
        </>
      )}
    </div>
  );
}

function Folder({
  c,
  date,
  now,
  open,
  onFlip,
  showTask,
  renderTask,
  onOpenTicket,
  onAddInto,
  inlineAdd,
  onEdit,
  manage,
  onAddArtifact,
  artifacts,
}: {
  manage: boolean;
  onAddArtifact?: () => void;
  artifacts?: ReactNode;
  c: Campaign;
  date: number;
  now: number;
  open: boolean;
  onFlip: () => void;
  showTask: (t: Todo) => boolean;
  renderTask: (t: Todo) => ReactNode;
  onOpenTicket: (id: string) => void;
  onAddInto: () => void;
  inlineAdd: boolean;
  onEdit: () => void;
}) {
  const { todos, activities, actuals, settings, updateTodo, updateTicket, addTodo, updateCampaign } = useSync();
  const addRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const addHere = () => {
    const name = draft.trim();
    if (!name) return;
    const act = activityOf(activities, c.activityIds.find((id) => activities.some((a) => a.id === id)) ?? "other");
    addTodo({ name, activityId: act.id, color: act.color, campaignId: c.id });
    setDraft("");
  };
  const tickets = useSync((s) => s.tickets ?? []);
  const meta = useTicketMeta();
  const [over, setOver] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const items = campaignItems(c, todos, tickets);
  const progress = campaignProgress(c, todos, tickets);
  const spent = campaignTime(c, actuals, settings.dayStart, now);
  const today = startOfDay(now);
  const due = c.due !== undefined ? dueLabel(c.due, today) : null;
  const late = c.due !== undefined && c.due < today && !c.done;
  const onDay = items.todos.filter((t) => !t.done && t.date !== undefined && isSameDay(t.date, date)).length;
  const byKey = (a: { order?: number; createdAt: number }, b: { order?: number; createdAt: number }) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
  // like the day's lists: a group (main + branches) stays together until all of it is done, and a
  // branch sits right under its main whatever their days
  const split = openAndDone(items.todos, showTask);
  const openTodos = withBranchesUnderMain(split.open.sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity) || byKey(a, b)));
  const doneTodos = withBranchesUnderMain(split.done.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)));
  // tickets dropped onto a task sit under it (wherever it is listed); the rest stand on their own
  const kids = ticketsUnderTasks(items.tickets, items.todos);
  const loose = items.tickets.filter((t) => !kids.nested.has(t.id));
  const openTickets = loose.filter((t) => t.statusGroup !== "complete").sort((a, b) => b.createdAt - a.createdAt);
  const doneTickets = loose.filter((t) => t.statusGroup === "complete");
  const task = (t: Todo) => (
    <TaskWithTickets key={t.id} t={t} kids={kids.byTask.get(t.id) ?? []} onTicket={(id) => updateTicket(id, { campaignId: c.id, parentTodoId: t.id })} onOver={() => setOver(false)} onOpenTicket={onOpenTicket} render={renderTask} />
  );
  const doneCount = doneTodos.length + doneTickets.length;

  return (
    <section
      data-project={c.id}
      data-done={c.done ? "1" : undefined}
      onDragOver={(e) => {
        const t = e.dataTransfer.types;
        if (!t.includes(TODO_DRAG_TYPE) && !t.includes(TICKET_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        const ticket = e.dataTransfer.getData(TICKET_DRAG_TYPE);
        const todo = getDraggingTodo() ?? e.dataTransfer.getData(TODO_DRAG_TYPE);
        if (!ticket && !todo) return;
        e.preventDefault();
        e.stopPropagation();
        // into the folder itself: a ticket under a task comes out from under it
        if (ticket) updateTicket(ticket, { campaignId: c.id, parentTodoId: undefined });
        else if (todo) updateTodo(todo, { campaignId: c.id });
      }}
      className={cx(
        "rounded-[12px] border border-fg/[0.07] bg-fg/[0.025] transition-colors",
        over && "bg-link/[0.06] outline-dashed outline-2 -outline-offset-2 outline-link/60",
        c.done && "opacity-60",
      )}
    >
      {/* line 1: name and actions; line 2: what it's linked to, and how it's going */}
      <header className="px-3 py-2">
        <div className="flex items-center gap-2">
          <button onClick={onFlip} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <ChevronRight size={12} className={cx("shrink-0 text-fg/50 transition-transform", open && "rotate-90")} />
            <FolderGlyph />
            <span className={cx("truncate text-[14px] font-medium", c.done && "line-through")}>{c.name}</span>
          </button>
          {onDay > 0 && <span className="shrink-0 rounded-full bg-link/[0.12] px-1.5 text-[11.5px] text-link">{onDay} today</span>}
          {due && <span className={cx("shrink-0 text-[11.5px] text-fg/55 tabular", late && "text-[#ff453a]")}>{due}</span>}
          <button
            aria-label={`Add to ${c.name}`}
            title="Add a task or ticket to this project"
            onClick={() => {
              onAddInto();
              if (inlineAdd) setTimeout(() => addRef.current?.focus(), 0); // once the folder is open
            }}
            className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-fg/50 hover:bg-fg/[0.08] hover:text-fg"
          >
            <PlusIcon size={13} />
          </button>
          {onAddArtifact && (
            <button
              data-add-artifact
              onClick={onAddArtifact}
              title="A new document in this project"
              className="flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[11.5px] text-fg/50 hover:bg-fg/[0.08] hover:text-fg"
            >
              <PlusIcon size={11} />
              Artifact
            </button>
          )}
          <button onClick={onEdit} className="shrink-0 rounded-full px-1.5 text-[11.5px] text-fg/50 hover:bg-fg/[0.08] hover:text-fg">
            Edit
          </button>
          {manage &&
            (c.done ? (
              <button
                data-reopen-project
                onClick={() => updateCampaign(c.id, { done: false })}
                title="Not finished after all: back on the home screen"
                className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] text-fg/60 ring-1 ring-fg/15 hover:bg-fg/[0.08] hover:text-fg"
              >
                Reopen
              </button>
            ) : (
              <button
                data-complete-project
                disabled={!allDone(progress)}
                onClick={() => updateCampaign(c.id, { done: true })}
                title={allDone(progress) ? "Finish this project: it leaves the home screen" : "Finish every task and ticket in it first"}
                className="shrink-0 rounded-full bg-[#30d158]/15 px-2 py-0.5 text-[11.5px] font-medium text-[#2a9f4a] hover:bg-[#30d158]/25 disabled:bg-fg/[0.05] disabled:font-normal disabled:text-fg/30"
              >
                Complete
              </button>
            ))}
        </div>
        <div className="mt-1 flex items-center gap-2 pl-[38px] text-[11px] text-fg/50">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {c.tags.map((id) => {
              const p = meta?.projects.find((x) => x.id === id);
              return p ? (
                <span key={id} className="shrink-0" style={{ color: `color-mix(in srgb, ${projectColor(meta, id)} 80%, var(--fg))` }}>
                  #{p.name}
                </span>
              ) : null;
            })}
            {c.activityIds.map((id) => {
              const a = activityOf(activities, id);
              return (
                <span key={id} className="flex shrink-0 items-center gap-1">
                  <span className="h-[6px] w-[6px] rounded-full" style={{ background: a.color }} />
                  {a.name}
                </span>
              );
            })}
          </span>
          <span className="flex shrink-0 items-center gap-2 tabular">
            {c.activityIds.length > 0 && <span title="Time in its activities">{fmtDuration(spent)}</span>}
            <span title="Done / all">
              {progress.done}/{progress.total} done
            </span>
          </span>
        </div>
      </header>
      {progress.total > 0 && (
        <div className="mx-3 mb-2 h-[3px] overflow-hidden rounded-full bg-fg/[0.07]">
          <div className="h-full rounded-full bg-[#30d158]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
      {artifacts}
      {open && (
        <div className="flex flex-col gap-2 px-2 pb-2">
          {/* stays put (no row appearing / going on focus, which moved what was under a tap) */}
          {inlineAdd && (
            <div className="flex items-center gap-2 rounded-[12px] border border-fg/10 bg-surface px-3 py-2">
              <PlusIcon size={14} className="text-fg/45" />
              <input
                ref={addRef}
                aria-label={`New task in ${c.name}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter") addHere();
                }}
                onBlur={addHere}
                placeholder="Add task"
                className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg/35"
              />
            </div>
          )}
          {openTodos.map(task)}
          {openTickets.map((t) => (
            <TicketItem key={t.id} t={t} onOpen={() => onOpenTicket(t.id)} />
          ))}
          {doneCount > 0 && (
            <>
              <button onClick={() => setShowDone((v) => !v)} className="flex items-center gap-2 px-1 text-left text-[12px] text-fg/50">
                <ChevronRight size={11} className={cx("transition-transform", showDone && "rotate-90")} />
                Done <span className="tabular">{doneCount}</span>
              </button>
              {showDone && (
                <>
                  {doneTodos.map(task)}
                  {doneTickets.map((t) => (
                    <TicketItem key={t.id} t={t} onOpen={() => onOpenTicket(t.id)} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Which tickets sit under which task (open first, then done; newest first), and the ids of those that do. */
export function ticketsUnderTasks(tickets: Ticket[], todos: Todo[]): { byTask: Map<string, Ticket[]>; nested: Set<string> } {
  const ids = new Set(todos.filter((t) => !t.done).map((t) => t.id));
  const doneIds = new Set(todos.filter((t) => t.done).map((t) => t.id));
  const byTask = new Map<string, Ticket[]>();
  const nested = new Set<string>();
  for (const k of tickets) {
    if (!k.parentTodoId) continue;
    // its task is gone or elsewhere: on its own; a done task keeps only done tickets (open work stays in sight)
    if (!ids.has(k.parentTodoId) && !(doneIds.has(k.parentTodoId) && k.statusGroup === "complete")) continue;
    nested.add(k.id);
    byTask.set(k.parentTodoId, [...(byTask.get(k.parentTodoId) ?? []), k]);
  }
  const done = (k: Ticket) => (k.statusGroup === "complete" ? 1 : 0);
  for (const list of byTask.values()) list.sort((a, b) => done(a) - done(b) || b.createdAt - a.createdAt);
  return { byTask, nested };
}

/** A task in a folder, with the tickets under it; drop a ticket on the task to put it there. */
function TaskWithTickets({
  t,
  kids,
  onTicket,
  onOver,
  onOpenTicket,
  render,
}: {
  t: Todo;
  kids: Ticket[];
  onTicket: (id: string) => void;
  onOver: () => void;
  onOpenTicket: (id: string) => void;
  render: (t: Todo) => ReactNode;
}) {
  const [hot, setHot] = useState(false);
  return (
    <div data-task-drop={t.id} className="flex flex-col gap-2">
      <div
        className={cx("rounded-[12px]", hot && "outline outline-2 outline-link/70")}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TICKET_DRAG_TYPE)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setHot(true);
          onOver();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setHot(false);
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(TICKET_DRAG_TYPE);
          setHot(false);
          if (!id) return;
          e.preventDefault();
          e.stopPropagation();
          onTicket(id);
        }}
      >
        {render(t)}
      </div>
      {kids.length > 0 && (
        <div data-sub-tickets={t.id} className="relative flex flex-col gap-2 pl-7">
          {/* the line down from the task to what's under it */}
          <span aria-hidden className="absolute bottom-4 left-[17px] top-0 w-px bg-fg/15" />
          {kids.map((k) => (
            <TicketItem key={k.id} t={k} onOpen={() => onOpenTicket(k.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-fg/45">
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.6h6a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
