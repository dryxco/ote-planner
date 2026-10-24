import { test } from "node:test";
import assert from "node:assert/strict";
import { foodKey, foodsForPrompt, learnFoods, resolveDish, type Food } from "./food-dictionary";

const butter: Food = { name: "해태 버터링 딥초코", per100g: 525, pieceGrams: 9, source: "해태 영양성분표", at: 1 };

test("one key for the ways a name gets written", () => {
  assert.equal(foodKey("버터링 딥초코"), foodKey("버터링딥초코"));
  assert.equal(foodKey("Cafe Latte"), foodKey("cafe-latte"));
  assert.notEqual(foodKey("버터링 (딥초코)"), foodKey("버터링"));
});

test("calories are per 100g × grams, worked out in code (Claude's own sum doesn't count)", () => {
  const d = resolveDish({ name: "삶은 달걀", amount: "2개 (100g)", per100g: 136, grams: 100, kcal: 999, source: "식약처 DB" }, {});
  assert.equal(d.kcal, 136);
  assert.equal(d.basis, "식약처 DB 100g당 136kcal × 100g = 136kcal");
});

test("a piece is one piece, not a serving: 1 wrapped 9g cookie is 47kcal, not a 30g serving's 158", () => {
  const d = resolveDish({ name: "해태 버터링 딥초코", amount: "1개 (30g)", per100g: 525, grams: 30, pieces: 1, pieceGrams: 9, kcal: 158 }, {});
  assert.equal(d.kcal, 47);
  assert.equal(d.amount, "1개 (9g)");
  assert.match(String(d.basis), /낱개 9g = 47kcal/);
});

test("a food read before keeps its name and figures, whatever the new reading says", () => {
  const dict = { [foodKey(butter.name)]: butter };
  const d = resolveDish({ name: "해태버터링 딥초코", amount: "3개", per100g: 480, pieces: 3, pieceGrams: 12, kcal: 170 }, dict);
  assert.equal(d.name, "해태 버터링 딥초코");
  assert.equal(d.kcal, Math.round(525 * 27 / 100));
  assert.equal(d.amount, "3개 (27g)");
  assert.equal(d.basis, "해태 영양성분표 100g당 525kcal × 3개 × 낱개 9g = 142kcal");
});

test("without the figures, Claude's number stays", () => {
  const raw = { name: "김치찌개", amount: "1그릇", kcal: 420, basis: "추정" };
  assert.deepEqual(resolveDish(raw, {}), raw);
  assert.equal(resolveDish({ name: "김치찌개", per100g: 50, kcal: 420 }, {}).kcal, 420);
});

test("new foods are learnt; one already known keeps its first figures", () => {
  const dict = { [foodKey(butter.name)]: butter };
  const add = learnFoods(
    [
      { name: "해태 버터링 딥초코", per100g: 480 },
      { name: "공기밥", per100g: 143, source: "식약처 DB" },
      { name: "공기 밥", per100g: 150 },
      { name: "물", per100g: null },
    ],
    dict,
    5,
  );
  assert.deepEqual(add, { [foodKey("공기밥")]: { name: "공기밥", per100g: 143, source: "식약처 DB", at: 5 } });
});

test("the dictionary told to Claude, newest first", () => {
  const rice: Food = { name: "공기밥", per100g: 143, at: 9 };
  assert.equal(foodsForPrompt({ a: butter, b: rice }), "공기밥: 100g당 143kcal\n해태 버터링 딥초코: 100g당 525kcal, 낱개 9g");
});
