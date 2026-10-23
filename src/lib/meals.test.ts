import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDishes, dayKcal, groupByTime, kindAt, mealKcal, mealsOn, timeOn } from "./meals";
import type { Meal } from "./types";

const at = (h: number, m = 0, day = 23) => new Date(2026, 9, day, h, m).getTime();
const meal = (id: string, t: number, kcals: (number | null)[]): Meal => ({ id, at: t, kind: "lunch", photos: [], dishes: kcals.map((k, i) => ({ name: `d${i}`, kcal: k })), status: "done", createdAt: t, updatedAt: t });

test("the kind of meal from the time", () => {
  assert.equal(kindAt(at(7, 30)), "breakfast");
  assert.equal(kindAt(at(10, 29)), "breakfast");
  assert.equal(kindAt(at(10, 30)), "lunch");
  assert.equal(kindAt(at(15, 30)), "snack");
  assert.equal(kindAt(at(19)), "dinner");
  assert.equal(kindAt(at(23)), "snack");
  assert.equal(kindAt(at(2)), "snack");
});

test("a day's meals, by the planner's day (a 1 a.m. snack belongs to the day before when days start at 4)", () => {
  const all = [meal("b", at(12), [500]), meal("a", at(8), [300]), meal("late", at(1, 0, 24), [200]), meal("next", at(9, 0, 24), [100])];
  const day = new Date(2026, 9, 23).getTime();
  assert.deepEqual(mealsOn(all, day, 4 * 60).map((m) => m.id), ["a", "b", "late"]);
  assert.deepEqual(mealsOn(all, day, 0).map((m) => m.id), ["a", "b"]);
});

test("calories add up; unknown dishes don't count", () => {
  assert.equal(mealKcal(meal("x", 0, [300, null, 150])), 450);
  assert.equal(mealKcal(meal("x", 0, [null])), null);
  assert.equal(dayKcal([meal("x", 0, [300]), meal("y", 0, [null]), meal("z", 0, [120])]), 420);
});

test("what comes back from the photos is cleaned up", () => {
  assert.deepEqual(cleanDishes([{ name: " 김치찌개 ", kcal: 420.4 }, { name: "", kcal: 10 }, { name: "물", kcal: -5 }, { name: "x".repeat(100), kcal: 9e9 }, null, "bad"]), [
    { name: "김치찌개", kcal: 420 },
    { name: "물", kcal: null },
    { name: "x".repeat(80), kcal: null },
  ]);
  assert.deepEqual(cleanDishes("nope"), []);
});

test("photos picked together split into meals by time; at most 4 to a meal", () => {
  const p = (id: string, h: number, m = 0) => ({ id, at: at(h, m) });
  const groups = groupByTime([p("l2", 12, 40), p("b1", 8), p("l1", 12, 10), p("b2", 8, 30), p("d1", 19)]);
  assert.deepEqual(groups.map((g) => g.map((x) => x.id)), [["b1", "b2"], ["l1", "l2"], ["d1"]]);
  const five = [0, 1, 2, 3, 4].map((i) => p(`x${i}`, 12, i));
  assert.deepEqual(groupByTime(five).map((g) => g.length), [4, 1]);
});

test("a photo from another day, picked for this day: this day at the current time", () => {
  const day = new Date(2026, 9, 20).getTime();
  assert.equal(timeOn(at(13, 5, 20), day, 0, at(9)), at(13, 5, 20), "taken that day: its own time");
  assert.equal(timeOn(at(13, 5, 23), day, 0, at(9, 15)), at(9, 15, 20), "otherwise that day, now's time");
  assert.equal(timeOn(at(13, 5, 23), day, 4 * 60, at(1, 30)), at(1, 30, 21), "before the day starts: the next calendar day");
});
