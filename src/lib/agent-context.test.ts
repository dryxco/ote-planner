import { test } from "node:test";
import assert from "node:assert/strict";
import { agentContext } from "./agent-ops";
import { useSync } from "./store";
import { useUI } from "./ui";
import type { Plan } from "./types";

const plan = (id: string, start: number, createdAt = 0): Plan =>
  ({ id, name: id, activityId: "work", color: "#000", allDay: false, start, end: start + 3600e3, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt }) as Plan;

test("the agent sees plans a month ahead (e.g. one it just added for 11/9 while viewing 10/9)", () => {
  const day = new Date(2026, 9, 9).getTime();
  useUI.setState({ date: day });
  useSync.setState({
    plans: [plan("next-month", new Date(2026, 10, 9, 9).getTime()), plan("way-later", new Date(2028, 0, 1).getTime()), plan("just-made", new Date(2028, 5, 1).getTime(), Date.now())],
  });
  const ids = agentContext().plans.map((p) => p.id);
  assert.ok(ids.includes("next-month"));
  assert.ok(!ids.includes("way-later"), "far future stays out");
  assert.ok(ids.includes("just-made"), "anything made in the last day is in, wherever it falls");
});
