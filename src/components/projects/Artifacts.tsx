"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Artifact, Campaign } from "@/lib/types";
import { useSync } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { artifactsOf, docText, editedLabel, stackGroups } from "@/lib/artifacts";
import { DocIcon, PlusIcon } from "../icons";
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

/** A new artifact in the project, opened in the editor. */
export function addArtifactTo(campaignId: string) {
  const id = useSync.getState().addArtifact(campaignId);
  useUI.getState().openArtifact(id);
}

type Card = { id: string; top: number; done: boolean };
type Drag = { id: string; from: number; dy: number };

/**
 * Computers: the space right of the project folders. Each project's artifacts are nodes next to it,
 * joined to a port on the card's right edge by curves (like a node editor). A project whose nodes run
 * past the next project pushes that one's nodes down. Drag a node up or down to reorder.
 */
export function ArtifactCanvas({ column, now }: { column: RefObject<HTMLElement | null>; now: number }) {
  const all = useSync((s) => s.artifacts) ?? [];
  const openArtifact = useUI((s) => s.openArtifact);
  const ref = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [colH, setColH] = useState(0);
  const [width, setWidth] = useState(0);
  const [hot, setHot] = useState<string | null>(null);
  // the node being dragged (its curve follows it)
  const [drag, setDrag] = useState<Drag | null>(null);

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

  // each project's group: from its card down, below the previous group's last node
  const withItems = cards.map((c) => ({ ...c, items: artifactsOf(all, c.id) }));
  const stack = stackGroups(withItems.map((c) => ({ id: c.id, top: c.top, count: c.items.length })), NODE_H, STEP, GROUP_GAP);
  const groups = withItems.map((c, i) => ({ ...c, top: stack.tops[i], port: c.top + PORT_Y }));
  const height = Math.max(colH, stack.bottom);
  const nodeW = Math.max(200, Math.min(NODE_W, width - NODE_X - 16));

  return (
    <div ref={ref} data-artifact-canvas className="relative min-w-0 flex-1" style={{ height }}>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={NODE_X} height={height} aria-hidden>
        {groups.flatMap((g) =>
          g.items.map((a, i) => {
            const y0 = g.port;
            const y1 = g.top + i * STEP + NODE_H / 2 + (drag?.id === a.id ? drag.dy : 0);
            const k = NODE_X * 0.55;
            return (
              <path
                key={a.id}
                data-curve={a.id}
                d={`M0 ${y0} C ${k} ${y0}, ${NODE_X - k} ${y1}, ${NODE_X} ${y1}`}
                fill="none"
                strokeWidth={hot === a.id || drag?.id === a.id ? 2 : 1.5}
                style={{ stroke: hot === a.id || drag?.id === a.id ? "var(--link)" : "color-mix(in srgb, var(--fg) 22%, transparent)" }}
                opacity={g.done ? 0.6 : 1}
              />
            );
          }),
        )}
      </svg>
      {groups.map((g) => (
        <Port key={g.id} y={g.port} linked={g.items.length > 0} onAdd={() => addArtifactTo(g.id)} />
      ))}
      {groups.map((g) => (
        <Group key={g.id} top={g.top} items={g.items} done={g.done} now={now} onOpen={openArtifact} onHot={setHot} nodeW={nodeW} drag={drag && g.items.some((a) => a.id === drag.id) ? drag : null} onDrag={setDrag} />
      ))}
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

/** One project's nodes, reordered by dragging (a straight line marks where it will go). */
function Group({
  top,
  items,
  done,
  now,
  onOpen,
  onHot,
  nodeW,
  drag,
  onDrag: setDrag,
}: {
  nodeW: number;
  top: number;
  items: Artifact[];
  done: boolean;
  now: number;
  onOpen: (id: string) => void;
  onHot: (id: string | null) => void;
  drag: Drag | null;
  onDrag: (d: Drag | null) => void;
}) {
  const moveArtifact = useSync((s) => s.moveArtifact);
  const dragged = useRef(false);
  const target = drag ? Math.max(0, Math.min(items.length - 1, Math.round((drag.from * STEP + drag.dy) / STEP))) : -1;
  // the line sits in the gap the node will land in (above the one it goes before, or below the one it follows)
  const lineY = drag && target !== drag.from ? (target < drag.from ? target * STEP - GAP / 2 : (target + 1) * STEP - GAP / 2) : null;

  const start = (e: React.PointerEvent, a: Artifact, from: number) => {
    if (e.button !== 0) return;
    const y0 = e.clientY;
    let moving = false;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      if (!moving && Math.abs(dy) < 4) return;
      moving = true;
      dragged.current = true;
      setDrag({ id: a.id, from, dy });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moving) return;
      const to = Math.max(0, Math.min(items.length - 1, Math.round((from * STEP + ev.clientY - y0) / STEP)));
      if (ev.type === "pointerup" && to !== from) moveArtifact(a.id, to);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div className="absolute right-0" style={{ top, left: NODE_X }}>
      {items.map((a, i) => {
        const lifted = drag?.id === a.id;
        return (
          <button
            key={a.id}
            data-artifact-node={a.id}
            onPointerDown={(e) => start(e, a, i)}
            onClick={() => {
              if (dragged.current) dragged.current = false;
              else onOpen(a.id);
            }}
            onKeyDown={(e) => {
              // ⌥↑ / ⌥↓ move it without a mouse
              if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              moveArtifact(a.id, i + (e.key === "ArrowUp" ? -1 : 1));
            }}
            onMouseEnter={() => onHot(a.id)}
            onMouseLeave={() => onHot(null)}
            onFocus={() => onHot(a.id)}
            onBlur={() => onHot(null)}
            style={{ top: i * STEP + (lifted ? drag.dy : 0), width: nodeW, height: NODE_H }}
            className={cx(
              "absolute left-0 flex touch-none select-none flex-col rounded-[12px] border border-fg/10 bg-surface px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:border-link/45 focus-visible:border-link focus-visible:outline-none",
              lifted ? "z-20 cursor-grabbing border-link/60 shadow-[0_10px_30px_rgba(0,0,0,0.28)]" : "transition-[border-color,box-shadow]",
              done && !lifted && "opacity-60",
            )}
          >
            {/* the curve's end on the node */}
            <span className="absolute -left-[4.5px] top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-full border-[1.5px] border-fg/40 bg-surface" />
            <NodeBody a={a} now={now} />
          </button>
        );
      })}
      {lineY !== null && <div data-drop-line className="pointer-events-none absolute left-0 z-30 h-[2px] rounded-none bg-link" style={{ top: lineY - 1, width: nodeW }} />}
    </div>
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
