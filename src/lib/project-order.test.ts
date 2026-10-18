import { test } from "node:test";
import assert from "node:assert/strict";
import { projectTree, projectUse } from "../components/tickets/ticket-ui";
import type { Ticket, TicketMeta } from "./types";

const meta: TicketMeta = {
  projects: [
    { id: "ax", name: "AX", parentId: null, color: null },
    { id: "acme", name: "Acme", parentId: null, color: null },
    { id: "admin", name: "Acme Admin", parentId: "acme", color: null },
    { id: "flow", name: "Flow (music)", parentId: "acme", color: null },
    { id: "ml", name: "ML", parentId: null, color: null },
  ],
  options: { status: [], priority: [], estimate: [] },
};
const tk = (projectId: string, n: number): Ticket[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${projectId}-${i}`, projectId, title: "", status: "Not started", createdAt: Date.now() - i * 1000 }));

test("# lists the projects I use most first; sub-projects stay under their parent, also by use", () => {
  const use = projectUse([...tk("flow", 5), ...tk("ml", 3), ...tk("admin", 1)]);
  assert.deepEqual(
    projectTree(meta, use).map((p) => p.name),
    ["Acme", "Flow (music)", "Acme Admin", "ML", "AX"],
  );
});

test("old tickets (over 90 days) don't count; unused keep the connector's order", () => {
  const old = tk("ml", 4).map((t) => ({ ...t, createdAt: Date.now() - 100 * 86_400_000 }));
  assert.deepEqual(projectTree(meta, projectUse(old)).map((p) => p.name), ["AX", "Acme", "Acme Admin", "Flow (music)", "ML"]);
});
