import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDrag, roundToStep } from "./drag";

const MIN = 60_000;
const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m).getTime();

test("roundToStep snaps to 5-minute marks on the local clock", () => {
  assert.equal(roundToStep(at(9, 2)), at(9, 0));
  assert.equal(roundToStep(at(9, 3)), at(9, 5));
  assert.equal(roundToStep(at(9, 57, ) + 40_000), at(10, 0));
});

test("move keeps duration and snaps start", () => {
  assert.deepEqual(applyDrag("move", at(9), at(10), 13 * MIN), [at(9, 15), at(10, 15)]);
  // unaligned blocks (e.g. from a timer) land on the grid
  assert.deepEqual(applyDrag("move", at(9, 37), at(9, 59), 1 * MIN), [at(9, 40), at(10, 2)]);
  assert.deepEqual(applyDrag("move", at(9), at(10), -62 * MIN), [at(8), at(9)]);
});

test("resize start/end never shorter than 5 minutes", () => {
  assert.deepEqual(applyDrag("start", at(9), at(10), 22 * MIN), [at(9, 20), at(10)]);
  assert.deepEqual(applyDrag("start", at(9), at(10), 90 * MIN), [at(9, 55), at(10)]);
  assert.deepEqual(applyDrag("end", at(9), at(10), -2 * 60 * MIN), [at(9), at(9, 5)]);
  assert.deepEqual(applyDrag("end", at(9), at(10), 31 * MIN), [at(9), at(10, 30)]);
});

test("maxEnd caps actuals at now", () => {
  assert.deepEqual(applyDrag("end", at(9), at(10), 3 * 60 * MIN, { maxEnd: at(11) }), [at(9), at(11)]);
  assert.deepEqual(applyDrag("move", at(9), at(10), 3 * 60 * MIN, { maxEnd: at(11) }), [at(10), at(11)]);
});

test("fractional times (from pointer positions) snap to whole steps", () => {
  assert.equal(roundToStep(at(9, 35) + 0.9458), at(9, 35));
  const [s, e] = applyDrag("move", at(9), at(10), 35 * MIN + 0.37);
  assert.deepEqual([s, e], [at(9, 35), at(10, 35)]);
});
