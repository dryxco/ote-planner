import { test } from "node:test";
import assert from "node:assert/strict";
import { useSync } from "./store";
import { agentContext, applyAgentOps } from "./agent-ops";

// the lookups go to /api/meals/estimate, which isn't there in a test: they fail quietly, the dish keeps kcal null
globalThis.fetch = (async () => {
  throw new TypeError("no server in tests");
}) as typeof fetch;

const at = (h: number, m = 0) => new Date(2026, 9, 24, h, m).getTime();

test("the agent sees meals and can add one, fix a dish (looked up unless a number is given), and remove", () => {
  useSync.setState({
    meals: [{ id: "b", at: at(8, 43), kind: "breakfast", photos: ["/p.jpg"], dishes: [{ name: "달걀", amount: "2개", kcal: 147, basis: "식약처" }], status: "done", createdAt: 1, updatedAt: 1 }],
  });
  const ctx = agentContext();
  assert.deepEqual(ctx.meals.map((m) => [m.id, m.kind, m.kcal_total, m.dishes[0].name]), [["b", "breakfast", 147, "달걀"]]);

  // "점심에 먹은 버거 프랭크버거 기본인데 칼로리 수정해줘" with no lunch logged: a lunch meal, kcal to look up
  const out = applyAgentOps([{ op: "add_meal", at: "2026-10-24T12:30", dishes: [{ name: "프랭크버거 기본버거", amount: "1개" }] }]);
  assert.match(out[0], /^✓ meal at 2026-10-24T12:30/);
  const lunch = useSync.getState().meals.find((m) => m.id !== "b")!;
  assert.equal(lunch.kind, "lunch", "kind from the time");
  assert.deepEqual(lunch.dishes, [{ name: "프랭크버거 기본버거", amount: "1개", kcal: null, added: true }]);

  // a number the user gives is kept as theirs
  applyAgentOps([{ op: "set_dish", meal_id: "b", index: 0, kcal: 156 }]);
  assert.deepEqual(useSync.getState().meals.find((m) => m.id === "b")!.dishes[0], { name: "달걀", amount: "2개", kcal: 156, basis: "직접 입력", added: true });
  // a new name without a number: looked up again
  applyAgentOps([{ op: "set_dish", meal_id: "b", index: 0, name: "구운 달걀" }]);
  assert.equal(useSync.getState().meals.find((m) => m.id === "b")!.dishes[0].kcal, null);
  // a dish added to a meal, one removed, a meal's kind changed, a meal deleted
  applyAgentOps([{ op: "set_dish", meal_id: "b", name: "바나나", amount: "1개", kcal: 98 }]);
  assert.equal(useSync.getState().meals.find((m) => m.id === "b")!.dishes.length, 2);
  applyAgentOps([{ op: "delete_dish", meal_id: "b", index: 0 }, { op: "update_meal", id: "b", kind: "snack" }]);
  const b = useSync.getState().meals.find((m) => m.id === "b")!;
  assert.deepEqual([b.kind, b.dishes.map((d) => d.name)], ["snack", ["바나나"]]);
  const bad = applyAgentOps([{ op: "set_dish", meal_id: "b", index: 9, kcal: 1 }, { op: "update_meal", id: "b", kind: "brunch" as never }, { op: "delete_meal", id: "nope" }]);
  assert.ok(bad.every((l) => l.startsWith("✗")), "bad refs are skipped with a reason");
  applyAgentOps([{ op: "delete_meal", id: lunch.id }]);
  assert.equal(useSync.getState().meals.length, 1);
});
