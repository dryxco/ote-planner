// Today grid geometry: one row per hour, time runs left→right inside a row (six 10-minute
// cells) and wraps to the next row, like text.
import { HOUR } from "./time";

export const CELLS_PER_ROW = 6; // 10-minute cells

export interface Segment {
  row: number;
  /** fraction of the row width, 0..1 */
  x0: number;
  x1: number;
  start: number;
  end: number;
  /** sharing its stretch of the row with other blocks: drawn in band `lane` of `lanes` (stacked) */
  lane?: number;
  lanes?: number;
}

/** One stretch of a block within a row: full height, or band `lane` of `lanes` where it overlaps. */
export interface LanePiece {
  x0: number;
  x1: number;
  lane: number;
  lanes: number;
  /** more blocks overlap here than there are bands: this stretch isn't drawn (see `overflow`) */
  hidden?: boolean;
}
export interface LaneOverflow {
  row: number;
  /** right edge of the overlapping stretch (fraction of the row) */
  x1: number;
  keys: string[];
}

/**
 * Overlapping blocks share an hour row as stacked bands (x is time, so they can't sit side by side)
 * — only over the minutes where they actually overlap; before and after, each keeps the full
 * height. At most `max` bands; blocks beyond that are hidden there and reported as overflow ("+n").
 * Only rows with overlaps get pieces; a block with no pieces for a row is drawn as usual.
 */
export function assignLanes(entries: { key: string; segs: Segment[] }[], max = 3): { lanes: Map<string, Map<number, LanePiece[]>>; overflow: LaneOverflow[] } {
  const byRow = new Map<number, { key: string; s: Segment }[]>();
  for (const e of entries) for (const s of e.segs) byRow.set(s.row, [...(byRow.get(s.row) ?? []), { key: e.key, s }]);
  const lanes = new Map<string, Map<number, LanePiece[]>>();
  const overflow: LaneOverflow[] = [];
  const EPS = 1e-9;
  // a block keeps its band from row to row (the one on top stays on top), else the earlier one goes first
  const startOf = new Map(entries.map((e) => [e.key, Math.min(...e.segs.map((x) => x.start))]));
  let prevRow = -2;
  let prevLanes = new Map<string, number>();
  for (const [row, list] of [...byRow].sort((a, b) => a[0] - b[0])) {
    const carried = row === prevRow + 1 ? prevLanes : new Map<string, number>();
    const rank = (k: string) => carried.get(k) ?? Infinity;
    list.sort(
      (a, b) =>
        a.s.x0 - b.s.x0 || rank(a.key) - rank(b.key) || startOf.get(a.key)! - startOf.get(b.key)! || a.key.localeCompare(b.key),
    );
    // a stable lane per block within the row (greedy interval colouring) so bands don't hop around
    const ends: number[] = [];
    const laneOf = new Map<string, number>();
    for (const c of list) {
      let lane = ends.findIndex((x) => x <= c.s.x0 + EPS);
      if (lane === -1) lane = ends.push(c.s.x1) - 1;
      else ends[lane] = c.s.x1;
      laneOf.set(c.key, lane);
    }
    prevRow = row;
    prevLanes = laneOf;
    // elementary stretches between all edges; in each, the covering blocks share it
    const xs = [...new Set(list.flatMap((c) => [c.s.x0, c.s.x1]))].sort((a, b) => a - b);
    const pieces = new Map<string, LanePiece[]>();
    let anyShared = false;
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i];
      const b = xs[i + 1];
      if (b - a < EPS) continue;
      const cover = list.filter((c) => c.s.x0 <= a + EPS && c.s.x1 >= b - EPS).sort((p, q) => laneOf.get(p.key)! - laneOf.get(q.key)!);
      const n = Math.min(cover.length, max);
      if (cover.length > 1) anyShared = true;
      const hidden = cover.slice(max).map((c) => c.key);
      if (hidden.length) {
        const prev = overflow[overflow.length - 1];
        if (prev && prev.row === row && Math.abs(prev.x1 - a) < EPS && prev.keys.join() === hidden.join()) prev.x1 = b;
        else overflow.push({ row, x1: b, keys: hidden });
      }
      cover.forEach((c, rank) => {
        const piece: LanePiece = { x0: a, x1: b, lane: Math.min(rank, n - 1), lanes: Math.max(n, 1), hidden: rank >= max };
        const ps = pieces.get(c.key) ?? [];
        const last = ps[ps.length - 1];
        // stretches in the same band merge into one piece
        if (last && Math.abs(last.x1 - a) < EPS && last.lane === piece.lane && last.lanes === piece.lanes && !!last.hidden === !!piece.hidden) last.x1 = b;
        else ps.push(piece);
        pieces.set(c.key, ps);
      });
    }
    if (!anyShared) continue;
    for (const [key, ps] of pieces) {
      if (ps.length === 1 && ps[0].lanes === 1) continue; // never shares this row: drawn as usual
      if (!lanes.has(key)) lanes.set(key, new Map());
      lanes.get(key)!.set(row, ps);
    }
  }
  return { lanes, overflow };
}

/** Vertical extent of a segment inside its row (px), taking its band into account. */
export function segmentBand(s: Segment, rowH: number, insetY = 2): { top: number; height: number } {
  const n = s.lanes ?? 1;
  const inner = rowH - 2 * insetY;
  if (n <= 1) return { top: s.row * rowH + insetY, height: inner };
  const gap = 1.5;
  const h = (inner - gap * (n - 1)) / n;
  return { top: s.row * rowH + insetY + (s.lane ?? 0) * (h + gap), height: h };
}

/** Split [start, end) into per-hour-row segments of a day that begins at `dayStart`. */
export function segmentsOf(start: number, end: number, dayStart: number, rows: number): Segment[] {
  const out: Segment[] = [];
  const s = Math.max(start, dayStart);
  const e = Math.min(end, dayStart + rows * HOUR);
  if (e <= s) return out;
  for (let row = Math.floor((s - dayStart) / HOUR); row < rows; row++) {
    const rs = dayStart + row * HOUR;
    const re = rs + HOUR;
    if (rs >= e) break;
    const a = Math.max(s, rs);
    const b = Math.min(e, re);
    if (b > a) out.push({ row, x0: (a - rs) / HOUR, x1: (b - rs) / HOUR, start: a, end: b });
  }
  return out;
}

/** Index of the segment that should carry the label: the widest, first on ties. */
export function labelSegment(segs: Segment[]): number {
  let best = 0;
  segs.forEach((s, i) => {
    if (s.x1 - s.x0 > segs[best].x1 - segs[best].x0 + 1e-9) best = i;
  });
  return best;
}

/** Time under a viewport point inside a column element (clamped to the day). */
export function timeAtPoint(
  column: HTMLElement,
  clientX: number,
  clientY: number,
  dayStart: number,
  rowH: number,
  rows: number,
): number {
  const r = column.getBoundingClientRect();
  const row = Math.min(rows - 1, Math.max(0, Math.floor((clientY - r.top) / rowH)));
  const frac = Math.min(0.9999, Math.max(0, (clientX - r.left) / r.width));
  return dayStart + row * HOUR + frac * HOUR;
}

/**
 * Outline of a wrapped block as SVG path(s): rows that touch horizontally merge into one shape
 * (like the original app), every corner — outer and inner steps — rounded by `radius`.
 * Coordinates are px inside the column (width `w`, row height `rowH`).
 */
export function blockPaths(
  segs: Segment[],
  w: number,
  rowH: number,
  {
    insetX = 1.5,
    insetY = 2,
    radius = 6,
    openTop = false,
    openBottom = false,
  }: {
    insetX?: number;
    insetY?: number;
    radius?: number;
    /** the block began before the day: run the shape past the top edge so it reads as cut off */
    openTop?: boolean;
    /** the block continues after the day: run it past the bottom edge */
    openBottom?: boolean;
  } = {},
): string[] {
  if (segs.length === 0 || w <= 0) return [];
  // a block that shares rows (bands, or several pieces in a row): one outline around the union
  if (segs.some((s, i) => (s.lanes ?? 1) > 1 || (i > 0 && segs[i - 1].row === s.row))) {
    return unionPaths(segs, w, rowH, { insetX, insetY, radius, openTop, openBottom });
  }
  // group consecutive rows whose intervals overlap
  const groups: Segment[][] = [];
  for (const s of segs) {
    const g = groups[groups.length - 1];
    const p = g?.[g.length - 1];
    if (p && s.row === p.row + 1 && Math.min(p.x1, s.x1) - Math.max(p.x0, s.x0) > 1e-6) g.push(s);
    else groups.push([s]);
  }
  return groups.map((g) => {
    const L = (s: Segment) => s.x0 * w + insetX;
    const R = (s: Segment) => s.x1 * w - insetX;
    const overrun = radius + 6; // far enough that corners and stroke fall outside the column
    const top = openTop && g === groups[0] && g[0].row === 0 ? -overrun : g[0].row * rowH + insetY;
    const last = groups[groups.length - 1];
    const bottom = openBottom && g === last ? (g[g.length - 1].row + 1) * rowH + overrun : (g[g.length - 1].row + 1) * rowH - insetY;
    const pts: [number, number][] = [];
    // clockwise: top edge, right side down (with steps), bottom edge, left side up
    pts.push([L(g[0]), top], [R(g[0]), top]);
    for (let i = 0; i < g.length; i++) {
      const yEnd = i === g.length - 1 ? bottom : (g[i].row + 1) * rowH;
      pts.push([R(g[i]), yEnd]);
      if (i < g.length - 1) pts.push([R(g[i + 1]), yEnd]);
    }
    pts.push([L(g[g.length - 1]), bottom]);
    for (let i = g.length - 1; i >= 0; i--) {
      const yStart = i === 0 ? top : g[i].row * rowH;
      pts.push([L(g[i]), yStart]);
      if (i > 0) pts.push([L(g[i - 1]), yStart]);
    }
    // drop duplicates / collinear points (steps of zero width)
    const clean: [number, number][] = [];
    for (const p of pts) {
      const q = clean[clean.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 0.01 || Math.abs(q[1] - p[1]) > 0.01) clean.push(p);
    }
    if (clean.length > 1 && Math.abs(clean[0][0] - clean[clean.length - 1][0]) < 0.01 && Math.abs(clean[0][1] - clean[clean.length - 1][1]) < 0.01) clean.pop();
    const poly = clean.filter((p, i) => {
      const a = clean[(i - 1 + clean.length) % clean.length];
      const b = clean[(i + 1) % clean.length];
      return !((Math.abs(a[0] - p[0]) < 0.01 && Math.abs(b[0] - p[0]) < 0.01) || (Math.abs(a[1] - p[1]) < 0.01 && Math.abs(b[1] - p[1]) < 0.01));
    });
    return roundedPath(poly, radius);
  });
}

/**
 * Outline(s) of a block whose rows are split into pieces (full height, or a band where it overlaps
 * others): the pieces are rectangles — touching ones joined without a seam, full-height pieces in
 * consecutive rows joined across the row line — and the union is traced as one rounded shape.
 */
function unionPaths(
  segs: Segment[],
  w: number,
  rowH: number,
  o: { insetX: number; insetY: number; radius: number; openTop: boolean; openBottom: boolean },
): string[] {
  const EPS = 1e-6;
  const full = (s: Segment) => (s.lanes ?? 1) <= 1;
  const sorted = [...segs].sort((a, b) => a.row - b.row || a.x0 - b.x0);
  const firstRow = sorted[0].row;
  const lastRow = sorted[sorted.length - 1].row;
  const overrun = o.radius + 6;
  const rects = sorted.map((s) => {
    const sameRow = sorted.filter((x) => x !== s && x.row === s.row);
    const joinedL = sameRow.some((x) => Math.abs(x.x1 - s.x0) < EPS);
    const joinedR = sameRow.some((x) => Math.abs(x.x0 - s.x1) < EPS);
    const band = segmentBand(s, rowH, o.insetY);
    let top = band.top;
    let bottom = band.top + band.height;
    // pieces that touch across a row line join there: one reaching its row's bottom (full height or
    // the lowest band) with one reaching the next row's top (full height or the highest band)
    const reachesTop = (x: Segment) => full(x) || (x.lane ?? 0) === 0;
    const reachesBottom = (x: Segment) => full(x) || (x.lane ?? 0) === (x.lanes ?? 1) - 1;
    const overlaps = (x: Segment) => Math.min(x.x1, s.x1) - Math.max(x.x0, s.x0) > EPS;
    if (reachesTop(s) && sorted.some((x) => x.row === s.row - 1 && reachesBottom(x) && overlaps(x))) top = s.row * rowH;
    if (reachesBottom(s) && sorted.some((x) => x.row === s.row + 1 && reachesTop(x) && overlaps(x))) bottom = (s.row + 1) * rowH;
    if (full(s)) {
      if (o.openTop && s.row === firstRow && s.row === 0) top = -overrun;
      if (o.openBottom && s.row === lastRow) bottom = (s.row + 1) * rowH + overrun;
    }
    return { x0: s.x0 * w + (joinedL ? 0 : o.insetX), x1: s.x1 * w - (joinedR ? 0 : o.insetX), y0: top, y1: bottom };
  });
  // union on the compressed grid of all edges, then walk its boundary (clockwise)
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
  const cov = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1 &&
    rects.some((r) => r.x0 <= xs[i] + EPS && r.x1 >= xs[i + 1] - EPS && r.y0 <= ys[j] + EPS && r.y1 >= ys[j + 1] - EPS);
  const key = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const next = new Map<string, [number, number][]>();
  const edge = (a: [number, number], b: [number, number]) => next.set(key(...a), [...(next.get(key(...a)) ?? []), b]);
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      if (!cov(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      if (!cov(i, j - 1)) edge([x0, y0], [x1, y0]);
      if (!cov(i + 1, j)) edge([x1, y0], [x1, y1]);
      if (!cov(i, j + 1)) edge([x1, y1], [x0, y1]);
      if (!cov(i - 1, j)) edge([x0, y1], [x0, y0]);
    }
  const paths: string[] = [];
  for (;;) {
    const startKey = [...next.keys()].find((k) => next.get(k)!.length);
    if (!startKey) break;
    const loop: [number, number][] = [];
    let cur = startKey;
    for (let guard = 0; guard < 10_000; guard++) {
      const outs = next.get(cur);
      if (!outs?.length) break;
      const p = outs.shift()!;
      loop.push(p);
      cur = key(...p);
      if (cur === startKey) break;
    }
    // drop collinear points
    const poly = loop.filter((p, i) => {
      const a = loop[(i - 1 + loop.length) % loop.length];
      const b = loop[(i + 1) % loop.length];
      return !((Math.abs(a[0] - p[0]) < 0.01 && Math.abs(b[0] - p[0]) < 0.01) || (Math.abs(a[1] - p[1]) < 0.01 && Math.abs(b[1] - p[1]) < 0.01));
    });
    if (poly.length >= 3) paths.push(roundedPath(poly, o.radius));
  }
  return paths;
}

/** Closed polygon with every corner rounded (quadratic), radius clamped to half of each edge. */
function roundedPath(pts: [number, number][], r: number): string {
  const n = pts.length;
  if (n < 3) return "";
  const d: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, la / 2);
    const rb = Math.min(r, lb / 2);
    const s: [number, number] = [p[0] + ((a[0] - p[0]) / la) * ra, p[1] + ((a[1] - p[1]) / la) * ra];
    const e: [number, number] = [p[0] + ((b[0] - p[0]) / lb) * rb, p[1] + ((b[1] - p[1]) / lb) * rb];
    d.push(`${i === 0 ? "M" : "L"}${s[0].toFixed(2)} ${s[1].toFixed(2)}Q${p[0].toFixed(2)} ${p[1].toFixed(2)} ${e[0].toFixed(2)} ${e[1].toFixed(2)}`);
  }
  return d.join("") + "Z";
}
