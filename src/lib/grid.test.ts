import { test } from "node:test";
import assert from "node:assert/strict";
import { assignLanes, blockPaths, labelSegment, segmentBand, segmentsOf, type Segment } from "./grid";

const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m).getTime();
const day = at(5);

test("a range wraps across hour rows, left to right", () => {
  // a seminar 10:30–12:30 -> right half of row 10, all of 11, left half of 12
  const segs = segmentsOf(at(10, 30), at(12, 30), day, 24);
  assert.deepEqual(
    segs.map((s) => [s.row, s.x0, s.x1]),
    [
      [5, 0.5, 1],
      [6, 0, 1],
      [7, 0, 0.5],
    ],
  );
});

test("Other 19:40–20:40: two cells in row 19, four in row 20; label on the longer piece", () => {
  const segs = segmentsOf(at(19, 40), at(20, 40), day, 24);
  assert.equal(segs.length, 2);
  assert.equal(Math.round((segs[0].x1 - segs[0].x0) * 6), 2);
  assert.equal(Math.round((segs[1].x1 - segs[1].x0) * 6), 4);
  assert.equal(labelSegment(segs), 1);
});

test("clipped to the day", () => {
  assert.deepEqual(segmentsOf(at(3), at(5, 30), day, 24).map((s) => [s.row, s.x0, s.x1]), [[0, 0, 0.5]]);
  assert.equal(segmentsOf(at(1), at(4), day, 24).length, 0);
});

test("blockPaths: overlapping rows merge into one shape; non-touching pieces stay separate", async () => {
  const { blockPaths } = await import("./grid");
  // the seminar 10:30-12:30 -> one connected shape
  assert.equal(blockPaths(segmentsOf(at(10, 30), at(12, 30), day, 24), 180, 30).length, 1);
  // Other 19:40-20:40 -> two separate shapes (they only meet at a corner)
  assert.equal(blockPaths(segmentsOf(at(19, 40), at(20, 40), day, 24), 180, 30).length, 2);
  // a single-row block is one rounded rect: 4 corners -> 4 quadratic curves
  const [p] = blockPaths(segmentsOf(at(9), at(10), day, 24), 180, 30);
  assert.equal((p.match(/Q/g) ?? []).length, 4);
  // the stair shape (10:30-12:30) has 8 corners
  const [stair] = blockPaths(segmentsOf(at(10, 30), at(12, 30), day, 24), 180, 30);
  assert.equal((stair.match(/Q/g) ?? []).length, 8);
});

test("blockPaths: a block cut at the day start runs past the top edge (no top corners inside)", async () => {
  const { blockPaths } = await import("./grid");
  const segs = segmentsOf(at(3), at(6, 30), day, 24); // started 03:00, day starts 05:00
  const [d] = blockPaths(segs, 180, 30, { openTop: true, radius: 7 });
  const ys = [...d.matchAll(/-?\d+\.\d+ (-?\d+\.\d+)/g)].map((m) => Number(m[1]));
  assert.ok(Math.min(...ys) < 0, "top edge is above the column");
  const [closed] = blockPaths(segs, 180, 30, { radius: 7 });
  const ys2 = [...closed.matchAll(/-?\d+\.\d+ (-?\d+\.\d+)/g)].map((m) => Number(m[1]));
  assert.ok(Math.min(...ys2) >= 0);
});

test("only the overlapping minutes are split into bands; the rest keeps the full height", () => {
  const seg = (row: number, x0: number, x1: number): Segment => ({ row, x0, x1, start: x0, end: x1 });
  const { lanes, overflow } = assignLanes([
    { key: "a", segs: [seg(0, 0, 1), seg(1, 0, 0.5)] }, // 0:00–1:30
    { key: "b", segs: [seg(1, 0.25, 1)] }, // 1:15–2:00
  ]);
  assert.equal(lanes.get("a")?.get(0), undefined, "row 0: a alone, drawn as usual");
  assert.deepEqual(lanes.get("a")?.get(1), [
    { x0: 0, x1: 0.25, lane: 0, lanes: 1, hidden: false },
    { x0: 0.25, x1: 0.5, lane: 0, lanes: 2, hidden: false },
  ]);
  assert.deepEqual(lanes.get("b")?.get(1), [
    { x0: 0.25, x1: 0.5, lane: 1, lanes: 2, hidden: false },
    { x0: 0.5, x1: 1, lane: 0, lanes: 1, hidden: false },
  ]);
  assert.deepEqual(overflow, []);
});

test("more than three at once: three bands there, the rest listed as overflow", () => {
  const seg = (x0: number, x1: number): Segment => ({ row: 3, x0, x1, start: x0, end: x1 });
  const { lanes, overflow } = assignLanes(["a", "b", "c", "d", "e"].map((key) => ({ key, segs: [seg(0.1, 0.9)] })));
  assert.deepEqual(lanes.get("c")?.get(3), [{ x0: 0.1, x1: 0.9, lane: 2, lanes: 3, hidden: false }]);
  assert.equal(lanes.get("d")?.get(3)?.[0].hidden, true);
  assert.deepEqual(overflow, [{ row: 3, x1: 0.9, keys: ["d", "e"] }]);
});

test("a banded segment is drawn on its own (not merged across rows)", () => {
  const segs: Segment[] = [
    { row: 0, x0: 0, x1: 1, start: 0, end: 1 },
    { row: 1, x0: 0, x1: 0.5, start: 1, end: 2, lane: 1, lanes: 2 },
  ];
  assert.equal(blockPaths(segs, 200, 30).length, 2);
  assert.deepEqual(segmentBand(segs[1], 30), { top: 30 + 2 + (26 - 1.5) / 2 + 1.5, height: (26 - 1.5) / 2 });
});

test("a block's full-height and banded stretches in one row form one seamless outline", () => {
  const segs: Segment[] = [
    { row: 2, x0: 0, x1: 0.5, start: 0, end: 1 }, // alone: full height
    { row: 2, x0: 0.5, x1: 1, start: 1, end: 2, lane: 0, lanes: 2 }, // overlapping: top band
  ];
  const paths = blockPaths(segs, 200, 30);
  assert.equal(paths.length, 1, "one shape, not two pieces");
});

test("a bottom band joins the block's next row without a slit", () => {
  const segs: Segment[] = [
    { row: 8, x0: 0, x1: 1 / 6, start: 0, end: 1, lane: 1, lanes: 2 }, // shared start of the row: lower band
    { row: 8, x0: 1 / 6, x1: 1, start: 1, end: 2 }, // then alone
    { row: 9, x0: 0, x1: 5 / 6, start: 2, end: 3 }, // next row, alone
  ];
  const paths = blockPaths(segs, 180, 30);
  assert.equal(paths.length, 1);
  // no 2px slit: the outline doesn't step back up between the band and the next row
  assert.ok(!/ 268\.00/.test(paths[0]), paths[0]);
});

test("a block keeps its band from row to row (no swapping where both run on)", () => {
  // booth setup 9:30–12:45, rehearsal 10:30–12:00 (both cover the whole 11 o'clock row)
  const booth = segmentsOf(at(9, 30), at(12, 45), day, 24);
  const talk = segmentsOf(at(10, 30), at(12), day, 24);
  // "zz" sorts after "aa" by key: the earlier start / carried band must win, not the key
  const { lanes } = assignLanes([
    { key: "zz-booth", segs: booth },
    { key: "aa-talk", segs: talk },
  ]);
  const r10 = booth[1].row;
  const r11 = r10 + 1;
  assert.equal(lanes.get("zz-booth")!.get(r10)!.at(-1)!.lane, 0, "booth on top at 10:30");
  assert.equal(lanes.get("zz-booth")!.get(r11)![0].lane, 0, "and still on top at 11");
  assert.equal(lanes.get("aa-talk")!.get(r11)![0].lane, 1);
});
