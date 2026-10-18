import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { StaleError, type RemoteTicket, type TicketSource } from "./connectors/types";
import { goesToSource, mergeTicket, type TicketNorm } from "./ticket-sync";

before(() => {
  process.env.SYNC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "ticket-sync-"));
});

const base: TicketNorm = { title: "Crop", status: "Not started", priority: null, estimate: null, due: null };

test("a status move made there survives a title edit made in Sync", () => {
  const sync = { ...base, title: "Crop (shift)" };
  const remote = { ...base, status: "In progress" };
  assert.deepEqual(mergeTicket(sync, remote, base), { ...base, title: "Crop (shift)", status: "In progress" });
});

test("a field changed on both sides: Sync's value", () => {
  assert.equal(mergeTicket({ ...base, status: "Done" }, { ...base, status: "In progress" }, base).status, "Done");
});

test("nothing changed in Sync: the source's values", () => {
  const remote = { ...base, status: "In review", due: "2026-10-12" };
  assert.deepEqual(mergeTicket(base, remote, base), remote);
});

test("tickets in my own (Sync-only) projects are never filed on a connector", () => {
  const t = { id: "t", projectId: "p-remote", title: "x", status: "Not started", createdAt: 0 };
  assert.equal(goesToSource(t), true);
  assert.equal(goesToSource({ ...t, hidden: true }), false);
  assert.equal(goesToSource({ ...t, projectId: "local:abc", local: true }), false);
  // even if the flag got lost, the project id keeps it home
  assert.equal(goesToSource({ ...t, projectId: "local:abc" }), false);
});

test("end to end: filed once, pulled, merged, and a stale write waits for the next run", async () => {
  const { syncTickets } = await import("./ticket-sync");
  const { applyServerChanges, readCollection } = await import("./syncdb");
  const owner = "e2e-tickets";
  const rows = new Map<string, RemoteTicket>();
  let n = 0;
  let stale = false;
  const src: TicketSource = {
    async meta() {
      return { projects: [{ id: "web", name: "Website", parentId: null, color: null }], options: { status: [{ name: "Todo", group: "to_do", color: null }, { name: "Doing", group: "in_progress", color: null }], priority: [], estimate: [] } };
    },
    async listMine() {
      return { tickets: [...rows.values()], complete: true };
    },
    async create(projectId, t) {
      const r: RemoteTicket = { id: `r${++n}`, containerId: "board", projectId, ...t, statusGroup: "to_do", updatedAt: 1 };
      rows.set(r.id, r);
      return r;
    },
    async update(t, v) {
      if (stale) throw new StaleError("changed there");
      const r = { ...t, ...v, updatedAt: (t.updatedAt ?? 0) + 1 };
      rows.set(r.id, r);
      return r;
    },
  };
  await applyServerChanges(owner, [{ col: "tickets", id: "s1", updatedAt: 1, data: { id: "s1", projectId: "web", title: "Fix header", status: "", createdAt: 1 } }]);
  let sum = await syncTickets(owner, src);
  assert.equal(sum.created, 1);
  assert.equal(rows.get("r1")?.status, "Todo", "an empty status takes the first to-do one");
  sum = await syncTickets(owner, src);
  assert.equal(sum.created, 0, "never filed twice");
  const linked = (await readCollection(owner, "tickets")).find((r) => r.id === "s1")!.data as { rowId: string; databaseId: string };
  assert.equal(linked.rowId, "r1");
  assert.equal(linked.databaseId, "board");

  // moved there; a new one assigned there comes in
  rows.set("r1", { ...rows.get("r1")!, status: "Doing", statusGroup: "in_progress" });
  rows.set("r9", { id: "r9", containerId: "board", projectId: "web", title: "Logo", status: "Todo", statusGroup: "to_do", priority: null, estimate: null, due: null });
  sum = await syncTickets(owner, src);
  assert.equal(sum.pulled, 2);
  const s1 = (await readCollection(owner, "tickets")).find((r) => r.id === "s1")!.data as { status: string };
  assert.equal(s1.status, "Doing");

  // renamed in Sync while it changed there: kept for the next run, not lost
  await applyServerChanges(owner, [{ col: "tickets", id: "s1", updatedAt: Date.now(), data: { ...s1, title: "Fix the header" } }]);
  stale = true;
  sum = await syncTickets(owner, src);
  assert.equal(sum.pushed, 0);
  stale = false;
  sum = await syncTickets(owner, src);
  assert.equal(sum.pushed, 1);
  assert.equal(rows.get("r1")?.title, "Fix the header");
  assert.equal(rows.get("r1")?.status, "Doing");

  // unassigned there: leaves Sync
  rows.delete("r9");
  sum = await syncTickets(owner, src);
  assert.equal(sum.removed, 1);
});
