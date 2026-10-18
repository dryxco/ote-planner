"use client";

import { useEffect, useRef, useState } from "react";
import type { Campaign, Ticket, Todo } from "@/lib/types";
import { OTHER_ID, activityOf, branchLabel, branchSort, openAndDone, stillCarried, useSync, withBranchesUnderMain } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { useNow } from "@/lib/hooks";
import { WEEKDAY_SHORT, fmtMinutesOfDay, isSameDay, logicalDayRange } from "@/lib/time";
import { BranchIcon, CheckIcon, ChevronRight, PlusIcon } from "../icons";
import { cx } from "../ui";
import { MissedRow } from "../MissedRow";
import { TODO_DRAG_TYPE, getDraggingTodo, setDraggingTodo } from "../today/Timeline";
import { NEW_PROJECT, ProjectPicker, hashQuery, noteProjectPick, pickerItems, projectColor, projectUse, useTicketMeta } from "../tickets/ticket-ui";
import { TicketSheet } from "../tickets/TicketSheet";
import { TicketBoard } from "../tickets/TicketBoard";
import { CampaignPicker, ProjectFolders, TicketItem, atQuery, campaignPickerItems } from "../projects/ProjectFolders";
import { ProjectSheet } from "../projects/ProjectSheet";

const VIEW_KEY = "sync-tasks-view";
const FILTER_KEY = "sync-tasks-filter";

/** Desktop centre-top: the selected day's to-dos plus undated ones (a board-style list). */
export function TasksPanel() {
  const { todos: allTodos, activities, addTodo, updateTodo, addTicket, addLocalProject, addCampaign, moveBranch } = useSync();
  const campaigns = useSync((s) => s.campaigns) ?? [];
  // tasks in a project live in its folder, not in the day's lists
  const todos = allTodos.filter((t) => !t.campaignId || !campaigns.some((c) => c.id === t.campaignId));
  const now = useNow(60_000);
  // the add box files into this project (its "+"), until cleared
  const [into, setInto] = useState<Campaign | null>(null);
  const [projectSheet, setProjectSheet] = useState<{ id: string | null } | null>(null);
  const tickets = useSync((s) => s.tickets ?? []);
  const updateTicket = useSync((s) => s.updateTicket);
  const date = useUI((s) => s.date);
  const [title, setTitle] = useState("");
  // Tasks | Tickets (my own projects' tickets and the connector's assigned to me); remembered per browser
  const [view, setView] = useState<"tasks" | "tickets">("tasks");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(VIEW_KEY) === "tickets") setView("tickets");
    } catch {}
  }, []);
  const show = (v: "tasks" | "tickets") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  // ⌘↵ anywhere (not while typing elsewhere): jump into the add box; there, ↵ or ⌘↵ adds
  const boxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.isComposing) return;
      const a = document.activeElement as HTMLElement | null;
      if (a === boxRef.current) return; // the box's own handler adds it
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      if (document.querySelector("[data-ticket-sheet], [role=dialog]")) return;
      e.preventDefault();
      boxRef.current?.focus();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  // ⌘⇧[ / ⌘⇧] (Ctrl on other systems): Tasks / Tickets
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return;
      if (e.code !== "BracketLeft" && e.code !== "BracketRight") return;
      e.preventDefault();
      const v = e.code === "BracketLeft" ? "tasks" : "tickets";
      setView(v);
      try {
        localStorage.setItem(VIEW_KEY, v);
      } catch {}
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  // "#" in the input: pick a project and the new item becomes a ticket there
  const [ticketProject, setTicketProject] = useState<{ id: string; name: string } | null>(null);
  const [pickIdx, setPickIdx] = useState(0);
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  // "#…" picks a ticket's project, "@…" the project (folder) to file into — whichever was typed last
  const atLast = title.lastIndexOf("@") > title.lastIndexOf("#");
  const hq = ticketProject || atLast ? null : hashQuery(title);
  const picking = hq !== null;
  const aq = into || !atLast ? null : atQuery(title);
  const atItems = aq !== null ? campaignPickerItems(campaigns, aq) : [];
  const meta = useTicketMeta();
  // Enter / arrows go through what matches the query (a parent shown only as a heading is skipped)
  // most used projects first — the project being filed into puts its own # projects on top
  const use = picking ? projectUse(tickets) : undefined;
  if (use && into) into.tags.forEach((id, i) => use.set(id, 1e6 - i));
  const pickable = picking ? pickerItems(meta, hq, use).filter((p) => !p.noBoard && !p.heading) : [];
  // filter by kind: an activity (Tasks) or a "#" project (Tickets); remembered per browser
  const [filter, setFilter] = useState<{ tasks: string | null; tickets: string | null }>({ tasks: null, tickets: null });
  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null") as typeof filter | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (f) setFilter({ tasks: f.tasks ?? null, tickets: f.tickets ?? null });
    } catch {}
  }, []);
  const pickFilter = (v: "tasks" | "tickets", id: string | null) =>
    setFilter((f) => {
      const next = { ...f, [v]: id };
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  const [undated, setUndated] = useState(false);
  const [actId, setActId] = useState(OTHER_ID);
  const [showNoDate, setShowNoDate] = useState(false);
  const [showDone, setShowDone] = useState(true);

  const d = new Date(date);
  // carried over (missed earlier, still open): listed under "Carried over" from the day after it was
  // missed — even if it got a date again — rather than in the day's list
  const isCarried = (t: Todo) => !t.done && stillCarried(t) && date > Math.max(...t.missed!);
  const onDay = openAndDone(todos, (t) => t.date !== undefined && isSameDay(t.date, date) && !isCarried(t));
  const open = withBranchesUnderMain(onDay.open.sort(byOrder));
  // undated to-dos (No date / Carried over) count as done on the day they were finished
  const dayStartMin = useSync((st) => st.settings.dayStart);
  const [ds, de] = logicalDayRange(date, dayStartMin);
  const doneUndated = todos.filter((t) => t.date === undefined && t.done && t.doneAt !== undefined && t.doneAt >= ds && t.doneAt < de);
  const done = withBranchesUnderMain([...onDay.done, ...doneUndated].sort(byOrder));
  // to-dos planned for this day but not done then (they rolled over): struck, under Done
  const missedHere = todos.filter((t) => t.missed?.some((m) => isSameDay(m, date)));
  // undated: what rolled over from a past day ("Carried over") apart from the rest ("No date")
  const undatedList = withBranchesUnderMain(openAndDone(todos, (t) => t.date === undefined).open.sort(byOrder));
  // carried over only from the day after the one it was missed on (that day shows it struck in place)
  // (not twice: a carried main that follows its branch into today's list shows there)
  const inDay = new Set(onDay.open.map((t) => t.id));
  const carried = withBranchesUnderMain(todos.filter((t) => isCarried(t) && !inDay.has(t.id)).sort(byOrder));
  const noDate = undatedList.filter((t) => !stillCarried(t));
  // left to do on this day: its open to-dos plus what's carried over (No date isn't counted)
  const tasksLeft = open.filter((t) => !t.done).length + carried.filter((t) => !t.done).length;
  const [showCarried, setShowCarried] = useState(true);
  const [showTickets, setShowTickets] = useState(true);

  // drag a row onto another to reorder (dropping into the other group also moves it to/off this day)
  const [hint, setHint] = useState<{ id: string; before: boolean } | null>(null);
  // a branch dropped on its main or a sibling: only the branches' order changes
  const siblingOf = (id: string | null, target: Todo) => {
    const t = id ? allTodos.find((x) => x.id === id) : undefined;
    return t?.branchOf && t.id !== target.id && (target.id === t.branchOf || target.branchOf === t.branchOf) ? t : undefined;
  };
  function dropBranch(t: Todo, target: Todo, before: boolean) {
    const rest = allTodos.filter((x) => x.branchOf === t.branchOf && x.id !== t.id).sort(branchSort);
    moveBranch(t.id, target.id === t.branchOf ? 0 : rest.findIndex((x) => x.id === target.id) + (before ? 0 : 1));
  }
  function dropOn(list: Todo[], target: Todo | null, before: boolean, dated: boolean) {
    const id = getDraggingTodo();
    setHint(null);
    setOverNoDate(false);
    if (!id || id === target?.id) return;
    const sib = target && siblingOf(id, target);
    if (sib && list.some((x) => x.id === id)) return dropBranch(sib, target, before);
    const rest = list.filter((x) => x.id !== id);
    // no target (dropped on a group's heading): to the end of that group
    const i = target ? rest.findIndex((x) => x.id === target.id) + (before ? 0 : 1) : rest.length;
    const prev = rest[i - 1];
    const next = rest[i];
    const t = todos.find((x) => x.id === id);
    const order = prev && next ? (keyOf(prev) + keyOf(next)) / 2 : prev ? keyOf(prev) + 1000 : next ? keyOf(next) - 1000 : (target ?? t) ? keyOf((target ?? t)!) : 0;
    // into No date: it stops being carried over (its missed days stay struck on those days);
    // back into Carried over: it is again
    const settled = list === noDate && t?.missed?.length ? Math.max(...t.missed) : list === carried ? undefined : t?.settled;
    // dropped here from a project folder: out of the project
    updateTodo(id, { order, settled, ...(dated ? { date } : { date: undefined, time: undefined, duration: undefined }), ...(t ? {} : { campaignId: undefined }) });
  }
  const [overNoDate, setOverNoDate] = useState(false);
  const row = (t: Todo, list: Todo[], dated: boolean) => (
    <TaskRow
      key={t.id}
      t={t}
      hint={hint?.id === t.id ? (hint.before ? "before" : "after") : null}
      onOver={(before) => setHint((h) => (h?.id === t.id && h.before === before ? h : { id: t.id, before }))}
      onLeave={() => setHint((h) => (h?.id === t.id ? null : h))}
      onDrop={(before) => dropOn(list, t, before, dated)}
    />
  );

  function pickProject(picked: { id: string; name: string }) {
    // "Create #name": a project of my own, in Sync only
    const p = picked.id === NEW_PROJECT ? { id: addLocalProject(picked.name), name: picked.name } : picked;
    noteProjectPick(p.id);
    setTicketProject(p);
    setTitle((t) => t.replace(/(^|\s)#[^#]*$/, "$1").trimEnd() + (t.replace(/(^|\s)#[^#]*$/, "").trim() ? " " : ""));
    setPickIdx(0);
  }
  /** "@name": file what's typed into that project ("Create @name" makes it). */
  function pickCampaign(p: { id: string | null; name: string }) {
    const id = p.id ?? addCampaign({ name: p.name, activityIds: [], tags: [] });
    const target = useSync.getState().campaigns.find((x) => x.id === id);
    if (!target) return;
    setInto(target);
    setTitle((t) => t.replace(/(^|\s)@[^@]*$/, "$1").trimEnd());
    setPickIdx(0);
    setUndated(true);
    const first = target.activityIds.find((id) => activities.some((a) => a.id === id));
    if (first) setActId(first);
  }
  function add(activity = actId) {
    const name = title.trim();
    if (ticketProject) {
      if (!name) return;
      const id = addTicket({ projectId: ticketProject.id, projectName: ticketProject.name, title: name });
      setTitle("");
      setTicketProject(null);
      if (into) updateTicket(id, { campaignId: into.id });
      else show("tickets"); // filed into a project: it shows in the folder, here
      return;
    }
    if (!name) return;
    const act = activityOf(activities, activity);
    addTodo({ name, activityId: act.id, color: act.color, date: undated ? undefined : date, ...(into ? { campaignId: into.id } : {}) });
    setTitle("");
  }

  // what the filter can pick: the kinds actually in this view
  const inProjects = allTodos.filter((t) => campaigns.some((c) => c.id === t.campaignId && !c.done));
  const taskKinds = [...new Set([...open, ...done, ...carried, ...noDate, ...missedHere, ...inProjects].map((t) => t.activityId))]
    .map((id) => activityOf(activities, id))
    .sort((a, b) => a.order - b.order)
    .map((a) => ({ id: a.id, name: a.name, color: a.color }));
  const ticketKinds = [...new Map(tickets.filter((t) => !t.hidden).map((t) => [t.projectId, t.projectName ?? ""])).entries()]
    .map(([id, name]) => ({ id, name: meta?.projects.find((p) => p.id === id)?.name ?? name, color: projectColor(meta, id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const kinds = view === "tasks" ? taskKinds : ticketKinds;
  const kind = kinds.some((k) => k.id === filter[view]) ? filter[view] : null;
  const ofKind = (t: Todo) => view !== "tasks" || !kind || t.activityId === kind;
  const openShown = open.filter(ofKind);
  const doneShown = done.filter(ofKind);
  const carriedShown = carried.filter(ofKind);
  const noDateShown = noDate.filter(ofKind);
  const missedShown = missedHere.filter(ofKind);
  const ticketsShown = view === "tickets" && kind ? tickets.filter((t) => t.projectId === kind) : tickets;
  const looseTickets = tickets
    .filter((t) => !t.hidden && (t.statusGroup ?? "to_do") !== "complete" && t.statusGroup !== "backlog" && !campaigns.some((c) => c.id === t.campaignId))
    .sort((a, b) => (a.statusGroup === "in_progress" ? 0 : 1) - (b.statusGroup === "in_progress" ? 0 : 1) || b.createdAt - a.createdAt);

  return (
    <section
      data-tasks-panel
      data-task-drop
      className="flex min-h-0 flex-1 flex-col rounded-[14px] outline-2 -outline-offset-2 outline-transparent transition-[outline-color,background-color] data-[drop-over]:bg-link/[0.06] data-[drop-over]:outline-dashed data-[drop-over]:outline-link/60"
    >
      <header className="flex items-baseline gap-2 px-1 pb-3">
        <h2 className="text-[20px] font-semibold">{view === "tickets" ? "Tickets" : "Tasks"}</h2>
        {(
          <span className="text-[13px] text-fg/50">
            {WEEKDAY_SHORT[d.getDay()]}, {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
        <div role="tablist" aria-label="Tasks or tickets" className="ml-auto flex self-center rounded-full bg-fg/[0.06] p-[3px] text-[12px]">
          {(["tasks", "tickets"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              title={v === "tasks" ? "Tasks (⌘⇧[)" : "Tickets (⌘⇧])"}
              onClick={() => show(v)}
              className={cx("rounded-full px-3 py-1", view === v ? "bg-surface font-medium text-fg shadow-sm" : "text-fg/55")}
            >
              {v === "tasks" ? "Tasks" : "Tickets"}
              {v === "tasks" && tasksLeft > 0 && <span className="ml-1 text-fg/45 tabular">{tasksLeft}</span>}
              {v === "tickets" && openTickets(tickets) > 0 && <span className="ml-1 text-fg/45 tabular">{openTickets(tickets)}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="relative flex items-center gap-2 rounded-[12px] border border-fg/10 bg-surface px-3 py-2">
        <PlusIcon size={16} className="text-fg/50" />
        {into && (
          <span data-into-project className="flex shrink-0 items-center gap-1 rounded-full bg-fg/[0.07] py-0.5 pl-2 pr-1 text-[12px] font-medium text-fg/75">
            @{into.name}
            <button aria-label="Not in a project" onClick={() => setInto(null)} className="rounded-full px-1 opacity-60 hover:opacity-100">
              ×
            </button>
          </span>
        )}
        {ticketProject && (
          <span
            data-ticket-project
            className="flex shrink-0 items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[12px] font-medium"
            style={{
              background: `color-mix(in srgb, ${projectColor(meta, ticketProject.id)} 15%, transparent)`,
              color: `color-mix(in srgb, ${projectColor(meta, ticketProject.id)} 85%, var(--fg))`,
            }}
          >
            # {ticketProject.name}
            <button aria-label="Not a ticket" onClick={() => setTicketProject(null)} className="rounded-full px-1 opacity-60 hover:opacity-100">
              ×
            </button>
          </span>
        )}
        <input
          ref={boxRef}
          data-add-box
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setPickIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (aq !== null && atItems.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPickIdx((i) => (i + (e.key === "ArrowDown" ? 1 : atItems.length - 1)) % atItems.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickCampaign(atItems[Math.min(pickIdx, atItems.length - 1)]);
                return;
              }
              if (e.key === "Escape") return setTitle((t) => t.replace(/(^|\s)@[^@]*$/, "$1"));
            }
            if (picking && pickable.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPickIdx((i) => (i + (e.key === "ArrowDown" ? 1 : pickable.length - 1)) % pickable.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickProject(pickable[Math.min(pickIdx, pickable.length - 1)]);
                return;
              }
            }
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !picking && aq === null && !ticketProject && view === "tasks") {
              // ↑/↓ in the box: previous / next activity for the new task
              e.preventDefault();
              const list = activeActivities(activities);
              const i = list.findIndex((a) => a.id === actId);
              setActId(list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1) + list.length) % list.length].id);
              return;
            }
            if (e.key === "Escape" && picking) setTitle((t) => t.replace(/(^|\s)#[^#]*$/, "$1"));
            else if (e.key === "Backspace" && !title && ticketProject) setTicketProject(null);
            else if (e.key === "Backspace" && !title && into) setInto(null);
            else if (e.key === "Enter") add();
          }}
          placeholder={ticketProject ? "Ticket title" : into ? "Add task" : view === "tickets" ? "Type # to pick a project" : "Add task  ·  # for ticket  ·  @ for project"}
          // while picking, the "#…" being typed takes the colour of the project it would pick
          style={picking && pickable.length ? { color: projectColor(meta, pickable[Math.min(pickIdx, pickable.length - 1)].id) } : undefined}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg/35"
        />
        {!ticketProject && !picking && aq === null && view === "tasks" && (
          <>
            {/* activity for the new task: a menu that always opens downward */}
            <ActivityMenu
              value={actId}
              onChange={setActId}
              onCommit={(id) => {
                // picked with ↵ / ⌘↵: add the task with it right away (or go back to typing it)
                setActId(id);
                if (title.trim()) add(id);
                else boxRef.current?.focus();
              }}
            />
            <button
              onClick={() => setUndated((v) => !v)}
              className={cx("shrink-0 rounded-full border px-2.5 py-1 text-[12px]", undated ? "border-fg/20 text-fg/70" : "border-[#0a84ff]/40 text-link")}
            >
              {undated ? "No date" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </button>
          </>
        )}
        {aq !== null && (
          <CampaignPicker items={atItems} active={Math.min(pickIdx, atItems.length - 1)} onHover={setPickIdx} onPick={pickCampaign} />
        )}
        {picking && (
          <ProjectPicker
            use={use}
            meta={meta}
            query={hq}
            active={pickable.length ? pickerItems(meta, hq, use).findIndex((p) => p.id === pickable[Math.min(pickIdx, pickable.length - 1)].id) : -1}
            onHover={(i) => {
              const id = pickerItems(meta, hq, use)[i]?.id;
              const k = pickable.findIndex((p) => p.id === id);
              if (k >= 0) setPickIdx(k);
            }}
            onPick={pickProject}
          />
        )}
      </div>

      {(kinds.length > 1 || kind) && (
        <div data-kind-filter role="radiogroup" aria-label="Filter by kind" className="no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto">
          {[{ id: null, name: "All", color: null } as { id: string | null; name: string; color: string | null }, ...kinds].map((k) => {
            const on = kind === k.id;
            return (
              <button
                key={k.id ?? "all"}
                role="radio"
                aria-checked={on}
                onClick={() => pickFilter(view, k.id)}
                className={cx(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12px]",
                  on ? "border-transparent bg-fg/[0.1] font-medium text-fg" : "border-fg/10 text-fg/60 hover:bg-fg/[0.05]",
                )}
              >
                {k.color && (view === "tasks" ? <span className="h-[7px] w-[7px] rounded-full" style={{ background: k.color }} /> : <span style={{ color: k.color }}>#</span>)}
                {k.name}
              </button>
            );
          })}
        </div>
      )}

      {view === "tickets" && <TicketBoard tickets={ticketsShown} dayStart={ds} dayEnd={de} onOpen={setOpenTicket} />}
      {openTicket && <TicketSheet id={openTicket} onClose={() => setOpenTicket(null)} />}

      <div className={cx("no-scrollbar mt-3 min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-4", view === "tasks" ? "flex" : "hidden")}>
        <ProjectFolders
          date={date}
          now={now}
          showTask={ofKind}
          renderTask={(t) => (
            <TaskRow
              key={t.id}
              t={t}
              hint={hint?.id === t.id ? (hint.before ? "before" : "after") : null}
              onOver={(before) => siblingOf(getDraggingTodo(), t) && setHint((h) => (h?.id === t.id && h.before === before ? h : { id: t.id, before }))}
              onLeave={() => setHint((h) => (h?.id === t.id ? null : h))}
              onDrop={(before) => {
                setHint(null);
                const sib = siblingOf(getDraggingTodo(), t);
                if (sib) dropBranch(sib, t, before);
              }}
              showDate
            />
          )}
          onOpenTicket={setOpenTicket}
          onAddInto={(c) => {
            setInto(c);
            setUndated(true); // a project's tasks start without a day; give one with the date button
            const first = c.activityIds.find((id) => activities.some((a) => a.id === id));
            if (first) setActId(first);
            boxRef.current?.focus();
          }}
          onEdit={(id) => setProjectSheet({ id })}
        />
        {/* the selected day's tasks outside any project */}
        <div className="mt-2 px-1 text-[13px] text-fg/60">
          {now >= ds && now < de ? "Today" : `${WEEKDAY_SHORT[d.getDay()]}, ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
        </div>
        {openShown.length === 0 && noDateShown.length === 0 && carriedShown.length === 0 && doneShown.length === 0 && missedShown.length === 0 && (
          <p className="py-6 text-center text-[13px] text-fg/35">{kind ? "No tasks of this kind for this day." : "No tasks for this day."}</p>
        )}
        {/* missed to-dos stay where they were in the day's list (struck), not under Done */}
        {withMissed(openShown, missedShown).map((t) => (missedShown.includes(t) ? <MissedRow key={`missed:${t.id}`} t={t} /> : row(t, open, true)))}

        {doneShown.length > 0 && (
          <>
            <button onClick={() => setShowDone((v) => !v)} className="mt-2 flex items-center gap-2 px-1 text-left text-[13px] text-fg/60">
              <ChevronRight size={12} className={cx("transition-transform", showDone && "rotate-90")} />
              Done <span className="rounded-full bg-fg/10 px-1.5 text-[11px] tabular">{doneShown.length}</span>
            </button>
            {showDone && doneShown.map((t) => row(t, done, true))}
          </>
        )}

        {carriedShown.length > 0 && (
          <>
            <button onClick={() => setShowCarried((v) => !v)} className="mt-2 flex items-center gap-2 px-1 text-left text-[13px] text-fg/60">
              <ChevronRight size={12} className={cx("transition-transform", showCarried && "rotate-90")} />
              Carried over <span className="rounded-full bg-[#ff453a]/15 px-1.5 text-[11px] text-[#ff453a] tabular">{carriedShown.length}</span>
            </button>
            {showCarried && carriedShown.map((t) => row(t, carried, false))}
          </>
        )}

        {/* shown while there's something carried over too, so one can be dropped here */}
        {(noDateShown.length > 0 || carriedShown.length > 0) && (
          <>
            <button
              data-no-date-head
              onClick={() => setShowNoDate((v) => !v)}
              onDragOver={(e) => {
                if (!getDraggingTodo() || !e.dataTransfer.types.includes(TODO_DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverNoDate(true);
              }}
              onDragLeave={() => setOverNoDate(false)}
              onDrop={(e) => {
                if (!getDraggingTodo()) return;
                e.preventDefault();
                dropOn(noDate, null, false, false);
              }}
              className={cx(
                "mt-2 flex items-center gap-2 rounded-[8px] px-1 text-left text-[13px] text-fg/60",
                overNoDate && "bg-link/[0.08] outline-dashed outline-2 outline-link/60",
              )}
            >
              <ChevronRight size={12} className={cx("transition-transform", showNoDate && "rotate-90")} />
              No date <span className="rounded-full bg-fg/10 px-1.5 text-[11px] tabular">{noDateShown.length}</span>
            </button>
            {showNoDate && noDateShown.map((t) => row(t, noDate, false))}
          </>
        )}

        {/* open tickets outside any project: here too, told apart by their status chip and # */}
        {!kind && looseTickets.length > 0 && (
          <>
            <button onClick={() => setShowTickets((v) => !v)} className="mt-2 flex items-center gap-2 px-1 text-left text-[13px] text-fg/60">
              <ChevronRight size={12} className={cx("transition-transform", showTickets && "rotate-90")} />
              Tickets <span className="rounded-full bg-fg/10 px-1.5 text-[11px] tabular">{looseTickets.length}</span>
            </button>
            {showTickets && looseTickets.map((t) => <TicketItem key={t.id} t={t} onOpen={() => setOpenTicket(t.id)} />)}
          </>
        )}
      </div>
      {projectSheet && <ProjectSheet id={projectSheet.id} onClose={() => setProjectSheet(null)} />}
    </section>
  );
}

const keyOf = (t: Todo) => t.order ?? t.createdAt;

const openTickets = (ts: Ticket[]) => ts.filter((t) => !t.hidden && t.statusGroup !== "complete" && t.statusGroup !== "backlog").length;
/** Put missed to-dos back where they sat in the day's order (between top-level rows; branches stay nested). */
function withMissed(list: Todo[], missed: Todo[]): Todo[] {
  const out = [...list];
  for (const m of [...missed].sort((a, b) => keyOf(a) - keyOf(b))) {
    const at = out.findIndex((t) => !t.branchOf && !missed.includes(t) && keyOf(t) > keyOf(m));
    if (at === -1) out.push(m);
    else out.splice(at, 0, m);
  }
  return out;
}
const byOrder = (a: Todo, b: Todo) => keyOf(a) - keyOf(b);

function TaskRow({
  t,
  hint,
  onOver,
  onLeave,
  onDrop,
  showDate,
}: {
  /** In a project folder: its day too (or "No date"). */
  showDate?: boolean;
  t: Todo;
  hint: "before" | "after" | null;
  onOver: (before: boolean) => void;
  onLeave: () => void;
  onDrop: (before: boolean) => void;
}) {
  const todos = useSync((st) => st.todos);
  const branchTodo = useSync((st) => st.branchTodo);
  const label = branchLabel(t, todos);
  const isBefore = (e: React.DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  };
  const { activities, toggleTodo } = useSync();
  const openEntry = useUI((s) => s.openEntry);
    const act = activityOf(activities, t.activityId);
    return (
      <div
        data-task={t.id}
        draggable
        title="Drag onto the timeline to schedule it"
        onDragStart={(e) => {
          e.dataTransfer.setData(TODO_DRAG_TYPE, t.id);
          e.dataTransfer.effectAllowed = "move";
          // drag a small chip, not the whole row
          const chip = document.createElement("div");
          chip.textContent = t.name;
          Object.assign(chip.style, {
            position: "fixed",
            top: "-200px",
            left: "0",
            maxWidth: "180px",
            padding: "4px 10px",
            borderRadius: "999px",
            font: "500 12px/1.3 var(--font-geist-sans), system-ui, sans-serif",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "var(--fg)",
            background: "var(--surface)",
            border: `1.5px solid ${t.color || act.color}`,
            boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
          });
          document.body.appendChild(chip);
          e.dataTransfer.setDragImage(chip, 14, 12);
          setTimeout(() => chip.remove(), 0);
          setDraggingTodo(t.id);
        }}
        onDragEnd={() => setDraggingTodo(null)}
        onDragOver={(e) => {
          const id = getDraggingTodo();
          if (!id || id === t.id || !e.dataTransfer.types.includes(TODO_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onOver(isBefore(e));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) onLeave();
        }}
        onDrop={(e) => {
          if (!getDraggingTodo()) return;
          e.preventDefault();
          onDrop(isBefore(e));
        }}
        className={cx(
          "group relative flex cursor-grab items-center gap-3 rounded-[12px] border border-fg/[0.07] bg-surface px-3.5 py-2.5 active:cursor-grabbing",
          t.branchOf && "ml-7", // a branch sits one step in, under its main
          // where the dragged task will land: a straight line in the gap (a shadow would bend round the corners)
          hint && "before:pointer-events-none before:absolute before:inset-x-0 before:h-[2px] before:bg-link",
          hint === "before" && "before:-top-[5px]",
          hint === "after" && "before:-bottom-[5px]",
        )}
      >
        <button
          aria-label={t.done ? "Mark not done" : "Mark done"}
          onClick={() => toggleTodo(t.id)}
          className={cx("flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-[1.5px]", t.done ? "border-transparent text-bg" : "border-fg/35")}
          style={t.done ? { background: t.color || act.color } : undefined}
        >
          {t.done && <CheckIcon size={12} />}
        </button>
        <button onClick={() => openEntry({ mode: "edit", kind: "todo", id: t.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className={cx("flex min-w-0 flex-1 items-center gap-1.5 text-[14px]", t.done && "text-fg/40")}>
            <span className={cx("truncate", t.done && "line-through")}>{t.name}</span>
            {label && <span data-branch-label className="shrink-0 text-[12px] text-fg/45 tabular">{label}</span>}
            {/* branch: duplicate this task (same details, its own time) */}
            <span
              role="button"
              tabIndex={0}
              aria-label="Branch this task"
              title="Branch: duplicate with its own time"
              onClick={(e) => {
                e.stopPropagation();
                branchTodo(t.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  branchTodo(t.id);
                }
              }}
              className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] text-fg/[0.1] transition-colors hover:bg-fg/[0.06] hover:text-fg/70"
            >
              <BranchIcon size={14} />
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-[11px] text-fg/45">
            {t.note?.trim() && <span title={t.note}>✎</span>}
            {showDate && <span className="tabular">{t.date !== undefined ? `${new Date(t.date).getMonth() + 1}/${new Date(t.date).getDate()}` : "No date"}</span>}
            {t.time !== undefined && (
              <span className="tabular">
                {fmtMinutesOfDay(t.time)}
                {t.duration ? `–${fmtMinutesOfDay((t.time + t.duration) % (24 * 60))}` : ""}
              </span>
            )}
            {t.deadline !== undefined && <span>due {new Date(t.deadline).getMonth() + 1}/{new Date(t.deadline).getDate()}</span>}
            {!t.done && stillCarried(t) && (
              <span className="text-[#ff453a]/80" title="Planned for this day and carried over">
                ↻ {new Date(t.missed![0]).getMonth() + 1}/{new Date(t.missed![0]).getDate()}
              </span>
            )}
            {/* activity on the right, not under the title */}
            <span className="flex items-center gap-1">
              <span className="h-[6px] w-[6px] rounded-full" style={{ background: t.color || act.color }} />
              {act.name}
            </span>
          </span>
        </button>
      </div>
    );
  }

const activeActivities = (acts: { id: string; archived?: boolean; order: number }[]) => [...acts].filter((a) => !a.archived).sort((a, b) => a.order - b.order);

function ActivityMenu({ value, onChange, onCommit }: { value: string; onChange: (id: string) => void; onCommit: (id: string) => void }) {
  const activities = useSync((s) => s.activities);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const cur = activityOf(activities, value);
  const list = activeActivities(activities) as typeof activities;
  // keyboard while open: ↑/↓ move, ↵ / ⌘↵ pick (and add the task), Esc closes
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setHi((i) => (i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
      } else if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        const a = list[hi];
        setOpen(false);
        if (a) onCommit(a.id);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [open, hi, list, onCommit]);
  return (
    <div className="relative shrink-0">
      <button
        aria-label="Task activity"
        aria-expanded={open}
        onClick={() => {
          setHi(Math.max(0, list.findIndex((a) => a.id === value)));
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1.5 rounded-full border border-fg/15 px-2.5 py-1 text-[12px] text-fg/75"
      >
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: cur.color }} />
        {cur.name}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className="animate-fade absolute right-0 top-[calc(100%+6px)] z-50 max-h-[320px] min-w-[170px] overflow-y-auto rounded-[12px] border border-fg/10 bg-surface py-1 shadow-2xl">
            {list.map((a, i) => (
                <button
                  key={a.id}
                  role="menuitem"
                  data-active={i === hi || undefined}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => {
                    onChange(a.id);
                    setOpen(false);
                  }}
                  className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]", i === hi ? "bg-fg/[0.08]" : "hover:bg-fg/[0.06]", a.id === value && "font-semibold")}
                >
                  <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: a.color }} />
                  <span className="flex-1 truncate">{a.name}</span>
                  {a.id === value && <CheckIcon size={12} className="text-link" />}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
