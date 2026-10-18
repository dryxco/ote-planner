"use client";

import { useEffect, useMemo, useState } from "react";
import { useSync } from "@/lib/store";
import type { Ticket, TicketGroup, TicketMeta } from "@/lib/types";
import { cx } from "../ui";
import { CheckIcon } from "../icons";

// status / project colours may be names (Notion-style palette)
const PALETTE: Record<string, string> = {
  gray: "#8f8d89",
  default: "#8f8d89",
  brown: "#a0785a",
  orange: "#e9883b",
  yellow: "#d4a72c",
  green: "#3f9b6a",
  blue: "#3b7fd4",
  purple: "#9065d0",
  pink: "#d05a9b",
  red: "#d9534f",
};
// until the connector sends project colours, each project gets a steady one from its id
const PROJECT_FALLBACK = ["#9065d0", "#3b7fd4", "#3f9b6a", "#e9883b", "#d05a9b", "#2aa3a3", "#c0812f", "#6d72e0", "#d9534f", "#5f9e3a"];
/** A project's colour: the connector's when it has one, else a steady pick per project. */
export function projectColor(meta: TicketMeta | null, id: string | undefined): string {
  const p = meta?.projects.find((x) => x.id === id);
  const parent = p?.parentId ? meta?.projects.find((x) => x.id === p.parentId) : undefined;
  const own = p?.color ?? parent?.color;
  if (own) return optionColor(own);
  let h = 0;
  for (const ch of id ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_FALLBACK[h % PROJECT_FALLBACK.length];
}
/** "# Project" in the project's colour. */
export function ProjectTag({ id, name, meta, className }: { id: string; name?: string; meta: TicketMeta | null; className?: string }) {
  const c = projectColor(meta, id);
  return (
    <span
      data-project-tag
      className={cx("inline-flex max-w-[160px] shrink-0 items-center truncate rounded-full px-2 py-[1px] text-[11.5px] font-medium", className)}
      style={{ background: `color-mix(in srgb, ${c} 15%, transparent)`, color: `color-mix(in srgb, ${c} 85%, var(--fg))` }}
    >
      # {name}
    </span>
  );
}

export const optionColor = (c: string | null | undefined, group?: TicketGroup) =>
  (c && (c.startsWith("#") ? c : PALETTE[c])) || (group === "complete" ? PALETTE.green : group === "in_progress" ? PALETTE.blue : group === "backlog" ? PALETTE.brown : PALETTE.gray);

/** A status ("Not started" / "In progress" / …) as a tinted chip. */
export function StatusChip({ name, color, group, className }: { name: string; color?: string | null; group?: TicketGroup; className?: string }) {
  const c = optionColor(color, group);
  return (
    <span
      data-ticket-status={name}
      className={cx("inline-flex shrink-0 items-center whitespace-nowrap rounded-[6px] px-2 py-[2px] text-[12px] font-medium", className)}
      style={{ background: `color-mix(in srgb, ${c} 18%, transparent)`, color: `color-mix(in srgb, ${c} 80%, var(--fg))` }}
    >
      {name || "—"}
    </span>
  );
}

// ---- projects + options (once per page load) ----

// A failed load isn't kept: it retries with backoff while something shows the projects, and says
// why meanwhile (a timeout used to leave "Loading projects…" up until the page was reloaded).
// No connector (404) = only projects of your own, nothing to wait for.
let meta: TicketMeta | null = null;
let metaError: string | null = null;
let metaInflight = false;
let metaFailures = 0;
let metaRetry: ReturnType<typeof setTimeout> | null = null;
const metaListeners = new Set<() => void>();
const metaChanged = () => metaListeners.forEach((l) => l());

function loadTicketMeta() {
  if (meta || metaInflight || metaRetry) return;
  metaInflight = true;
  fetch("/api/connector/tickets/meta", { cache: "no-store" })
    .then(async (r): Promise<{ meta: TicketMeta } | { error: string; final: boolean }> => {
      if (r.ok) return { meta: (await r.json()) as TicketMeta };
      const body = (await r.json().catch(() => null)) as { error?: string } | null;
      if (r.status === 404) return { meta: { projects: [], options: { status: DEFAULT_STATUS, priority: DEFAULT_PRIORITY, estimate: DEFAULT_ESTIMATE } } };
      return { error: body?.error ?? `Couldn't load the connector's projects (HTTP ${r.status})`, final: false };
    })
    .catch(() => ({ error: "Can't reach the server", final: false as boolean }))
    .then((res) => {
      metaInflight = false;
      if ("meta" in res) {
        meta = res.meta;
        metaError = null;
        metaFailures = 0;
      } else {
        metaError = res.error;
        metaFailures++;
        if (!res.final && metaListeners.size)
          metaRetry = setTimeout(() => {
            metaRetry = null;
            if (metaListeners.size) loadTicketMeta();
          }, Math.min(30_000, 2_000 * 2 ** (metaFailures - 1)));
      }
      metaChanged();
    });
}

function useMetaState<T>(pick: () => T): T {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    metaListeners.add(l);
    loadTicketMeta();
    return () => {
      metaListeners.delete(l);
    };
  }, []);
  return pick();
}
/** The connector's projects and options, plus my Ote-only projects (usable before / without one). */
export function useTicketMeta(): TicketMeta | null {
  const remote = useMetaState(() => meta);
  const local = useSync((s) => s.settings.localProjects);
  return useMemo(() => withLocal(remote, local), [remote, local]);
}
/** Whether the connector's projects are in, and why not (retrying meanwhile) when they aren't. */
export const useRemoteProjects = (): { loaded: boolean; error: string | null } =>
  useMetaState(() => ({ loaded: !!meta, error: meta ? null : metaError }));

/** Statuses for tickets in projects of your own (and until / unless a connector sends its own). */
export const DEFAULT_STATUS: TicketMeta["options"]["status"] = [
  { name: "Not started", group: "to_do", color: "gray" },
  { name: "In progress", group: "in_progress", color: "blue" },
  { name: "In review", group: "in_progress", color: "purple" },
  { name: "Done", group: "complete", color: "green" },
  { name: "Backlog", group: "backlog", color: "brown" },
];
export const DEFAULT_PRIORITY = ["Urgent", "High", "Medium", "Low"];
export const DEFAULT_ESTIMATE = ["< 1 hour", "Half a day", "1 day", "2–3 days", "1 week+"];
type LocalProjects = NonNullable<import("@/lib/types").Settings["localProjects"]>;
function withLocal(remote: TicketMeta | null, local: LocalProjects | undefined): TicketMeta | null {
  if (!local?.length) return remote;
  const mine = local.map((p) => ({ id: p.id, name: p.name, parentId: null, color: p.color ?? null, local: true }));
  return remote
    ? { ...remote, projects: [...remote.projects, ...mine] }
    : { projects: mine, options: { status: DEFAULT_STATUS, priority: DEFAULT_PRIORITY, estimate: DEFAULT_ESTIMATE } };
}

// ---- how much each project is used (for the "#" order) ----

const USE_KEY = "sync-project-use";
const USE_WINDOW = 90 * 86_400_000;
/** Remember a "#" pick (this browser; the last 90 days count). */
export function noteProjectPick(id: string) {
  try {
    const m = JSON.parse(localStorage.getItem(USE_KEY) ?? "{}") as Record<string, number[]>;
    const now = Date.now();
    m[id] = [...(m[id] ?? []).filter((t) => t > now - USE_WINDOW), now].slice(-50);
    localStorage.setItem(USE_KEY, JSON.stringify(m));
  } catch {}
}
/** Use per project: my tickets there from the last 90 days, plus "#" picks (counted double). */
export function projectUse(tickets: Ticket[]): Map<string, number> {
  const now = Date.now();
  const use = new Map<string, number>();
  for (const t of tickets) if (t.createdAt > now - USE_WINDOW) use.set(t.projectId, (use.get(t.projectId) ?? 0) + 1);
  try {
    const m = JSON.parse(localStorage.getItem(USE_KEY) ?? "{}") as Record<string, number[]>;
    for (const [id, ts] of Object.entries(m)) use.set(id, (use.get(id) ?? 0) + 2 * ts.filter((t) => t > now - USE_WINDOW).length);
  } catch {}
  return use;
}

/**
 * Projects with each root's sub-projects one step in, most used first: a root
 * ranks by its busiest project (itself or a sub-project); ties keep the connector's order.
 */
export function projectTree(meta: TicketMeta | null, use: Map<string, number> = new Map()) {
  const ps = meta?.projects ?? [];
  const ids = new Set(ps.map((p) => p.id));
  const u = (id: string) => use.get(id) ?? 0;
  const byUse = <T extends { id: string }>(list: T[], score: (x: T) => number) =>
    list.map((x, i) => ({ x, i, s: score(x) })).sort((a, b) => b.s - a.s || a.i - b.i).map((e) => e.x);
  const kids = (id: string) => ps.filter((p) => p.parentId === id);
  const roots = byUse(
    ps.filter((p) => !p.parentId || !ids.has(p.parentId)),
    (r) => Math.max(u(r.id), ...kids(r.id).map((c) => u(c.id))),
  );
  const out: (TicketMeta["projects"][number] & { depth: number })[] = [];
  for (const r of roots) {
    out.push({ ...r, depth: 0 });
    for (const c of byUse(kids(r.id), (c) => u(c.id))) out.push({ ...c, depth: 1 });
  }
  return out;
}

/** Picker row that makes a new Ote-only project named after the query. */
export const NEW_PROJECT = "new:";

/**
 * The "#" list: the connector's projects (sub-projects under their parent) and my Ote-only ones, filtered by
 * what follows the "#"; a name nothing has yet offers to create it (Ote only).
 * Arrow keys / Enter are handled by the input (see `useProjectKeys`).
 */
export function ProjectPicker({
  meta,
  query,
  active,
  onPick,
  onHover,
  use,
}: {
  use?: Map<string, number>;
  meta: TicketMeta | null;
  query: string;
  active: number;
  onPick: (p: { id: string; name: string }) => void;
  onHover: (i: number) => void;
}) {
  const items = pickerItems(meta, query, use);
  const remote = useRemoteProjects();
  // keep the row chosen with the arrow keys in view
  useEffect(() => {
    document.querySelector('[data-project-picker] [aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  return (
    <div data-project-picker role="listbox" className="animate-fade absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[320px] overflow-y-auto rounded-[12px] border border-fg/10 bg-surface py-1 shadow-2xl">
      <p className="px-3 pb-1 pt-1.5 text-[11px] text-fg/45">Make it a ticket in…</p>
      {!remote.loaded && (
        <p className="px-3 py-2 text-[13px] text-fg/45">
          {remote.error ? `${remote.error} — retrying…` : "Loading projects…"}
        </p>
      )}
      {!query.trim() && !items.length && remote.loaded && <p className="px-3 py-2 text-[13px] text-fg/45">Type a name to make a project of your own</p>}
      {items.map((p, i) => (
        <button
          key={p.id}
          role="option"
          aria-selected={i === active}
          disabled={p.noBoard}
          data-heading={p.heading || undefined}
          // only a moving pointer picks: one resting where the list opens (after clicking a folder's +) must not
          onMouseMove={() => i !== active && onHover(i)}
          onMouseDown={(e) => e.preventDefault()} // keep the input focused
          onClick={() => !p.noBoard && onPick(p)}
          className={cx(
            "flex w-full items-center gap-2 py-1.5 pr-3 text-left text-[13.5px]",
            p.depth ? "pl-8" : "pl-3",
            i === active && !p.noBoard && "bg-[#4f5bd5]/[0.12] font-medium",
            p.noBoard ? "cursor-default font-semibold text-fg/60" : p.heading ? "text-fg/55 hover:bg-fg/[0.06]" : "hover:bg-fg/[0.06]",
          )}
        >
          {p.depth > 0 && <span className="-ml-4 text-fg/30">↳</span>}
          {p.create ? (
            <>
              <span className="w-[8px] shrink-0 text-center text-fg/50">+</span>
              <span className="truncate">
                Create <span className="font-medium">#{p.name}</span>
              </span>
              <span className="shrink-0 text-[11px] text-fg/40">Ote only</span>
            </>
          ) : (
            <>
              <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: projectColor(meta, p.id) }} />
              <span className="truncate" style={p.noBoard || p.heading ? undefined : { color: `color-mix(in srgb, ${projectColor(meta, p.id)} 70%, var(--fg))` }}>
                {p.name}
              </span>
              {p.local && <span className="shrink-0 text-[11px] text-fg/40">Ote only</span>}
            </>
          )}
          {i === active && !p.noBoard && <span className="ml-auto text-[11px] text-fg/40">↵</span>}
        </button>
      ))}
    </div>
  );
}
export function pickerItems(meta: TicketMeta | null, query: string, use?: Map<string, number>) {
  const q = query.trim().toLowerCase();
  const tree = projectTree(meta, use).map((p) => ({ ...p, heading: !!p.noBoard, create: false }));
  if (!q) return tree;
  const hit = new Set(tree.filter((p) => p.name.toLowerCase().includes(q)).map((p) => p.id));
  // a matching sub-project keeps its parent above it, as a heading (not picked by Enter)
  const out = tree
    .filter((p) => hit.has(p.id) || tree.some((c) => c.parentId === p.id && hit.has(c.id)))
    .map((p) => ({ ...p, heading: p.heading || !hit.has(p.id) }));
  if (!tree.some((p) => p.name.trim().toLowerCase() === q))
    out.push({ id: NEW_PROJECT, name: query.trim(), parentId: null, color: null, depth: 0, heading: false, create: true });
  return out;
}

/** "#query" being typed at the end of the input (the picker's filter), or null. */
export function hashQuery(text: string): string | null {
  const m = /(?:^|\s)#([^#\s][^#]*|)$/.exec(text);
  return m ? m[1] : null;
}

/** Ticket row for the Tickets list. */
export function TicketRow({ t, onOpen }: { t: Ticket; onOpen: () => void }) {
  const done = t.statusGroup === "complete";
  const meta = useTicketMeta();
  return (
    <button
      data-ticket={t.id}
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-[12px] border border-fg/[0.07] bg-surface px-3.5 py-2.5 text-left"
    >
      <StatusChip name={t.status} color={t.statusColor} group={t.statusGroup} />
      <span className={cx("min-w-0 flex-1 truncate text-[14px]", done && "text-fg/45 line-through")}>{t.title || "Untitled"}</span>
      <span className="flex shrink-0 items-center gap-2 text-[11px] text-fg/45">
        {!t.rowId && !t.local && <span title="Being filed on the connected service">uploading…</span>}
        {t.due && <span>due {Number(t.due.slice(5, 7))}/{Number(t.due.slice(8, 10))}</span>}
        <ProjectTag id={t.projectId} name={t.projectName} meta={meta} />
      </span>
    </button>
  );
}

/** A small menu of option names (status / priority / estimate). */
export function OptionMenu({
  value,
  options,
  onChange,
  empty = "Empty",
  allowClear,
  label,
}: {
  value: string | null | undefined;
  options: { name: string; color?: string | null; group?: TicketGroup }[];
  onChange: (v: string | null) => void;
  empty?: string;
  allowClear?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.name === value);
  return (
    <div className="relative">
      <button aria-label={label} onClick={() => setOpen((v) => !v)} className="rounded-[6px] px-1 py-0.5 text-left hover:bg-fg/[0.05]">
        {value ? (
          cur?.color !== undefined || cur?.group ? (
            <StatusChip name={value} color={cur?.color} group={cur?.group} className="text-[13.5px]" />
          ) : (
            <span className="text-[14.5px]">{value}</span>
          )
        ) : (
          <span className="text-[14.5px] text-fg/35">{empty}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div role="menu" className="animate-fade absolute left-0 top-[calc(100%+4px)] z-[71] max-h-[280px] min-w-[180px] overflow-y-auto rounded-[12px] border border-fg/10 bg-surface py-1 shadow-2xl">
            {allowClear && (
              <button
                role="menuitem"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="flex w-full px-3 py-1.5 text-left text-[13px] text-fg/50 hover:bg-fg/[0.06]"
              >
                {empty}
              </button>
            )}
            {options.map((o) => (
              <button
                key={o.name}
                role="menuitem"
                onClick={() => {
                  onChange(o.name);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-fg/[0.06]"
              >
                {o.color !== undefined || o.group ? <StatusChip name={o.name} color={o.color} group={o.group} /> : <span className="flex-1">{o.name}</span>}
                {o.name === value && <CheckIcon size={12} className="ml-auto text-link" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---- a ticket's detail (description, history, comments), fetched ahead on hover ----

const details = new Map<string, { at: number; p: Promise<unknown> }>();
/** The ticket sheet's data; hovering a card starts it (and its images) so opening is instant. */
export function loadTicketDetail(db: string, row: string): Promise<unknown> {
  const k = `${db}/${row}`;
  const hit = details.get(k);
  if (hit && Date.now() - hit.at < 20_000) return hit.p;
  const p = fetch(`/api/connector/tickets/detail?db=${encodeURIComponent(db)}&row=${encodeURIComponent(row)}`, { cache: "no-store" }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) {
      details.delete(k);
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    // warm the images too
    for (const m of String(j.body ?? "").matchAll(/\/media\/([A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8})/g)) {
      const img = new Image();
      img.src = `/api/connector/tickets/media?name=${encodeURIComponent(m[1])}`;
    }
    return j;
  });
  details.set(k, { at: Date.now(), p });
  return p;
}
/** After an edit (description, image, comment) the next open reads it fresh. */
export const forgetTicketDetail = (db: string, row: string) => void details.delete(`${db}/${row}`);
