"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Artifact, Campaign } from "@/lib/types";
import { useSync } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { artifactsOf, docText, editedLabel, stackGroups } from "@/lib/artifacts";
import { DocIcon, FolderIcon, PlusIcon } from "../icons";
import { cx } from "../ui";

/** Node size and spacing on the canvas. */
/** Node width at most (narrower when the window is), and height. */
const NODE_W = 288;
const NODE_H = 96;
const GAP = 10;
const STEP = NODE_H + GAP;
/** Where the nodes start, right of the project cards (the curves run across this). */
const NODE_X = 88;
/** Space kept between one project's nodes and the next project's. */
const GROUP_GAP = 22;
/** The port sits on the card's first line (its name). */
const PORT_Y = 20;
/** ⌥← / ⌥→ moves a node this far. */
const NUDGE = 24;

/** A new artifact in the project, opened in the editor. */
export function addArtifactTo(campaignId: string) {
  const id = useSync.getState().addArtifact(campaignId);
  useUI.getState().openArtifact(id);
}

type Card = { id: string; top: number; done: boolean };
/** The node being dragged: how far it has come, and whether it goes back in line (Shift). */
type Drag = { id: string; dx: number; dy: number; line: boolean };
/** Where a node is drawn on the canvas (left from the nodes' column, top from the canvas's top). */
type Spot = { a: Artifact; left: number; top: number; card: Card; done: boolean };

/**
 * Computers: the space right of the project folders. Each project's artifacts are nodes next to it,
 * joined to a port on the card's right edge by curves (like a node editor). Nodes stand in a line
 * level with their card (a project whose line runs past the next one's card pushes that one's down);
 * a node dragged somewhere stays there, over others if need be, and moves with its card. Shift-drag
 * puts a node back in the line, at the place it's dropped (a straight line marks it).
 */
export function ArtifactCanvas({ column, now }: { column: RefObject<HTMLElement | null>; now: number }) {
  const all = useSync((s) => s.artifacts) ?? [];
  const openArtifact = useUI((s) => s.openArtifact);
  const { moveArtifact, placeArtifact } = useSync.getState();
  const ref = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [colH, setColH] = useState(0);
  const [width, setWidth] = useState(0);
  const [hot, setHot] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragged = useRef(false);

  // where each project's card is (they move as folders open and close)
  useLayoutEffect(() => {
    const col = column.current;
    const me = ref.current;
    if (!col || !me) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const base = me.getBoundingClientRect().top;
      const next = [...col.querySelectorAll<HTMLElement>("[data-project]")].map((el) => ({
        id: el.dataset.project!,
        top: Math.round(el.getBoundingClientRect().top - base),
        done: el.dataset.done === "1",
      }));
      setCards((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setColH(Math.round(col.getBoundingClientRect().height));
      setWidth(Math.round(me.getBoundingClientRect().width));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const ro = new ResizeObserver(soon);
    ro.observe(col);
    ro.observe(me);
    const mo = new MutationObserver(soon);
    mo.observe(col, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-project", "data-done"] });
    window.addEventListener("resize", soon);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", soon);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [column]);

  const nodeW = Math.max(200, Math.min(NODE_W, width - NODE_X - 16));
  // how far right a node can sit (the canvas's width, whatever the window)
  const maxX = Math.max(0, width - NODE_X - nodeW - 16);
  const placed = (a: Artifact) => a.y !== undefined;
  // each project's line (the nodes not placed freely): from its card down, below the previous line
  const withItems = cards.map((c) => ({ card: c, items: artifactsOf(all, c.id) }));
  const stack = stackGroups(withItems.map((g) => ({ id: g.card.id, top: g.card.top, count: g.items.filter((a) => !placed(a)).length })), NODE_H, STEP, GROUP_GAP);
  const spots: Spot[] = withItems.flatMap((g, gi) => {
    let slot = 0;
    return g.items.map((a) => {
      const left = Math.min(maxX, a.x ?? 0);
      const top = placed(a) ? Math.max(0, g.card.top + a.y!) : stack.tops[gi] + slot++ * STEP;
      return { a, left, top, card: g.card, done: g.card.done };
    });
  });
  const lineTops = new Map(withItems.map((g, gi) => [g.card.id, stack.tops[gi]]));
  const height = Math.max(colH, stack.bottom, ...spots.map((p) => p.top + NODE_H + GROUP_GAP));
  const at = (p: Spot) => (drag?.id === p.a.id ? { left: Math.max(0, Math.min(maxX, p.left + drag.dx)), top: Math.max(0, p.top + drag.dy) } : p);

  // Shift-drag: the line's place it would take (its project's nodes in line, without it)
  const lineDrop = (() => {
    if (!drag?.line) return null;
    const me = spots.find((p) => p.a.id === drag.id);
    if (!me) return null;
    const line = spots.filter((p) => p.card.id === me.card.id && p.a.id !== me.a.id && !placed(p.a));
    const top0 = lineTops.get(me.card.id) ?? me.card.top;
    const slot = Math.max(0, Math.min(line.length, Math.round((at(me).top - top0) / STEP)));
    const sibs = artifactsOf(all, me.card.id).filter((a) => a.id !== me.a.id);
    const index = slot < line.length ? sibs.findIndex((a) => a.id === line[slot].a.id) : line.length ? sibs.findIndex((a) => a.id === line[line.length - 1].a.id) + 1 : sibs.length;
    return { index, y: top0 + slot * STEP - GAP / 2 };
  })();
  const dropRef = useRef(lineDrop);
  useLayoutEffect(() => {
    dropRef.current = lineDrop;
  });

  const start = (e: React.PointerEvent, p: Spot) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moving = false;
    dragged.current = false;
    const now = (ev: PointerEvent): Drag => ({ id: p.a.id, dx: ev.clientX - x0, dy: ev.clientY - y0, line: ev.shiftKey });
    const move = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moving = true;
      dragged.current = true;
      setDrag(now(ev));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moving) return;
      if (ev.type === "pointerup") {
        const d = now(ev);
        if (d.line) {
          const drop = dropRef.current;
          moveArtifact(p.a.id, drop?.index ?? 0);
        } else {
          const left = Math.max(0, Math.min(maxX, p.left + d.dx));
          const top = Math.max(0, p.top + d.dy);
          placeArtifact(p.a.id, { x: left, y: top - p.card.top });
        }
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // Shift pressed or let go mid-drag: the line's marker comes and goes
  useLayoutEffect(() => {
    if (!drag) return;
    const key = (e: KeyboardEvent) => setDrag((d) => (d && d.line !== e.shiftKey ? { ...d, line: e.shiftKey } : d));
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
    };
  }, [drag]);

  return (
    <div ref={ref} data-artifact-canvas className="relative min-w-0 flex-1" style={{ height }}>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={Math.max(NODE_X, width)} height={height} aria-hidden>
        {spots.map((p) => {
          const q = at(p);
          const y0 = p.card.top + PORT_Y;
          const y1 = q.top + NODE_H / 2;
          const x1 = NODE_X + q.left;
          const k = x1 * 0.55;
          const lit = hot === p.a.id || drag?.id === p.a.id;
          return (
            <path
              key={p.a.id}
              data-curve={p.a.id}
              d={`M0 ${y0} C ${k} ${y0}, ${x1 - k} ${y1}, ${x1} ${y1}`}
              fill="none"
              strokeWidth={lit ? 2 : 1.5}
              style={{ stroke: lit ? "var(--link)" : "color-mix(in srgb, var(--fg) 22%, transparent)" }}
              opacity={p.done ? 0.6 : 1}
            />
          );
        })}
      </svg>
      {withItems.map((g) => (
        <Port key={g.card.id} y={g.card.top + PORT_Y} linked={g.items.length > 0} onAdd={() => addArtifactTo(g.card.id)} />
      ))}
      <div className="absolute inset-y-0 right-0" style={{ left: NODE_X }}>
        {spots.map((p) => {
          const q = at(p);
          const lifted = drag?.id === p.a.id;
          const line = artifactsOf(all, p.card.id);
          return (
            <button
              key={p.a.id}
              data-artifact-node={p.a.id}
              data-placed={placed(p.a) || undefined}
              onPointerDown={(e) => start(e, p)}
              onClick={() => {
                if (dragged.current) dragged.current = false;
                else openArtifact(p.a.id);
              }}
              onKeyDown={(e) => {
                // ⌥ + arrows move it; ⌥⇧↑ / ⌥⇧↓ move it in its project's line
                if (!e.altKey || !e.key.startsWith("Arrow")) return;
                e.preventDefault();
                const up = e.key === "ArrowUp";
                if (e.shiftKey && (up || e.key === "ArrowDown")) {
                  moveArtifact(p.a.id, line.findIndex((a) => a.id === p.a.id) + (up ? -1 : 1));
                  return;
                }
                const dx = e.key === "ArrowLeft" ? -NUDGE : e.key === "ArrowRight" ? NUDGE : 0;
                const dy = up ? -NUDGE : e.key === "ArrowDown" ? NUDGE : 0;
                placeArtifact(p.a.id, { x: Math.max(0, Math.min(maxX, p.left + dx)), y: Math.max(0, p.top + dy) - p.card.top });
              }}
              onMouseEnter={() => setHot(p.a.id)}
              onMouseLeave={() => setHot(null)}
              onFocus={() => setHot(p.a.id)}
              onBlur={() => setHot(null)}
              style={{ top: q.top, left: q.left, width: nodeW, height: NODE_H, zIndex: lifted ? 30 : hot === p.a.id ? 20 : undefined }}
              className={cx(
                "absolute flex touch-none select-none flex-col rounded-[12px] border border-fg/10 bg-surface px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:border-link/45 focus-visible:border-link focus-visible:outline-none",
                lifted ? "cursor-grabbing border-link/60 shadow-[0_10px_30px_rgba(0,0,0,0.28)]" : "transition-[border-color,box-shadow]",
                placed(p.a) && !lifted && "shadow-[0_2px_8px_rgba(0,0,0,0.16)]",
                p.done && !lifted && "opacity-60",
              )}
            >
              {/* the curve's end on the node */}
              <span className="absolute -left-[4.5px] top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-full border-[1.5px] border-fg/40 bg-surface" />
              <NodeBody a={p.a} now={now} />
            </button>
          );
        })}
        {lineDrop && <div data-drop-line className="pointer-events-none absolute left-0 z-40 h-[2px] rounded-none bg-link" style={{ top: lineDrop.y - 1, width: nodeW }} />}
      </div>
    </div>
  );
}

/** The circle on a card's right edge; on hover it becomes "+" (a new artifact). */
function Port({ y, linked, onAdd }: { y: number; linked: boolean; onAdd: () => void }) {

  return (
    <button
      data-port
      aria-label="New artifact"
      title="New artifact"
      onClick={onAdd}
      className="group absolute left-0 z-10 flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ top: y }}
    >
      <span
        className={cx(
          "flex h-[10px] w-[10px] items-center justify-center rounded-full border-[1.5px] transition-all group-hover:h-[20px] group-hover:w-[20px] group-hover:border-link group-hover:bg-link group-hover:text-white group-focus-visible:h-[20px] group-focus-visible:w-[20px] group-focus-visible:border-link group-focus-visible:bg-link group-focus-visible:text-white",
          linked ? "border-fg/45 bg-surface-3" : "border-fg/30 bg-bg",
        )}
      >
        <PlusIcon size={11} className="hidden group-hover:block group-focus-visible:block" />
      </span>
    </button>
  );
}

function NodeBody({ a, now }: { a: Artifact; now: number }) {
  const text = docText(a.body, 120);
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <DocIcon size={13} className="shrink-0 text-fg/45" />
        <span className={cx("truncate text-[13.5px] font-medium", !a.title && "text-fg/45")}>{a.title || "Untitled"}</span>
      </span>
      <span className="mt-1 line-clamp-2 text-[12px] leading-[16px] text-fg/55">{text || <span className="text-fg/30">Empty</span>}</span>
      <span className="mt-auto text-[10.5px] text-fg/40 tabular">Edited {editedLabel(a.updatedAt, now)}</span>
    </>
  );
}

/** Phones: a project's artifacts listed under it; "+ Artifact" while the folder is open. */
export function ArtifactList({ c, now, open }: { c: Campaign; now: number; open: boolean }) {
  const all = useSync((s) => s.artifacts) ?? [];
  const openArtifact = useUI((s) => s.openArtifact);
  const items = artifactsOf(all, c.id);
  if (!items.length && !open) return null;
  return (
    <div data-artifact-list={c.id} className="flex flex-col gap-1 px-2 pb-2">
      {items.map((a) => (
        <button key={a.id} data-artifact-row={a.id} onClick={() => openArtifact(a.id)} className="flex items-center gap-2.5 rounded-[10px] bg-surface px-3 py-2 text-left">
          <DocIcon size={15} className="shrink-0 text-fg/45" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cx("truncate text-[13.5px] font-medium", !a.title && "text-fg/45")}>{a.title || "Untitled"}</span>
            {docText(a.body, 80) && <span className="truncate text-[12px] text-fg/50">{docText(a.body, 80)}</span>}
          </span>
          <span className="shrink-0 text-[11px] text-fg/40 tabular">{editedLabel(a.updatedAt, now)}</span>
        </button>
      ))}
      {open && (
      <button data-add-artifact onClick={() => addArtifactTo(c.id)} className="flex items-center gap-2 self-start rounded-full px-2 py-1 text-[12.5px] text-link hover:bg-link/[0.08]">
        <PlusIcon size={12} />
        Artifact
      </button>
      )}
    </div>
  );
}

/** "All", the ones on their own (""), or one project's. */
type Shelf = "all" | string;

/**
 * Every artifact in one place (the Artifacts button on the Projects tab): newest edits first, each
 * with its project; filter by project or the ones on their own, and start one that isn't in a project.
 */
export function ArtifactGallery({ now }: { now: number }) {
  const all = useSync((s) => s.artifacts) ?? [];
  const campaigns = useSync((s) => s.campaigns) ?? [];
  const openArtifact = useUI((s) => s.openArtifact);
  const [shelf, setShelf] = useState<Shelf>("all");
  const nameOf = (id: string) => campaigns.find((c) => c.id === id)?.name;
  // a project that's gone leaves its id behind: shown as on its own
  const home = (a: Artifact) => (a.campaignId && nameOf(a.campaignId) ? a.campaignId : "");
  const shelves: { id: Shelf; name: string; n: number }[] = [
    { id: "all", name: "All", n: all.length },
    { id: "", name: "No project", n: all.filter((a) => home(a) === "").length },
    ...campaigns.map((c) => ({ id: c.id, name: c.name, n: all.filter((a) => home(a) === c.id).length })).filter((x) => x.n > 0),
  ];
  const shown = all.filter((a) => shelf === "all" || home(a) === shelf).sort((a, b) => b.updatedAt - a.updatedAt);
  const create = () => {
    const id = useSync.getState().addArtifact(shelf === "all" ? "" : shelf);
    openArtifact(id);
  };
  return (
    <div data-artifact-gallery className="mx-auto max-w-[1100px]">
      <div className="mb-4 flex items-center gap-2">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {shelves.map((x) => (
            <button
              key={x.id || "none"}
              data-shelf={x.id || "none"}
              aria-pressed={shelf === x.id}
              onClick={() => setShelf(x.id)}
              className={cx(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12px]",
                shelf === x.id ? "border-transparent bg-fg/[0.1] font-medium text-fg" : "border-fg/10 text-fg/60 hover:bg-fg/[0.05]",
              )}
            >
              {x.name}
              <span className="tabular text-fg/40">{x.n}</span>
            </button>
          ))}
        </div>
        <button data-new-artifact onClick={create} className="flex shrink-0 items-center gap-1 rounded-full bg-link px-3 py-1 text-[12.5px] font-medium text-white">
          <PlusIcon size={12} />
          New artifact
        </button>
      </div>
      {shown.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {shown.map((a) => {
            const p = home(a) ? nameOf(home(a)) : null;
            return (
              <button
                key={a.id}
                data-gallery-item={a.id}
                onClick={() => openArtifact(a.id)}
                className="flex h-[132px] flex-col rounded-[12px] border border-fg/10 bg-surface px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:border-link/45 focus-visible:border-link focus-visible:outline-none"
              >
                <NodeBody a={a} now={now} />
                <span className={cx("mt-1.5 flex min-w-0 items-center gap-1 text-[11px]", p ? "text-fg/55" : "text-fg/35")}>
                  {p ? <FolderIcon size={11} className="shrink-0" /> : null}
                  <span className="truncate">{p ?? "No project"}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-[13px] text-fg/45">
          <DocIcon size={22} className="text-fg/30" />
          {shelf === "all" ? "No artifacts yet." : "Nothing here."}
          <button onClick={create} className="text-link">
            Start one
          </button>
        </div>
      )}
    </div>
  );
}
