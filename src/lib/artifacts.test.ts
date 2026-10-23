import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Artifact, ArtifactDoc } from "./types";
import { artifactsOf, docImages, docText, editedLabel, moveKeys, stackGroups, withoutInlineImages } from "./artifacts";
import { useSync, type SyncState } from "./store";
import { applyChanges, diffState } from "./sync-client";
import { isSyncChange } from "./sync-protocol";
import { redo, startUndo, undo } from "./undo";

const art = (id: string, campaignId: string, order: number, o: Partial<Artifact> = {}): Artifact => ({ id, campaignId, title: id, body: null, order, createdAt: 0, updatedAt: 0, ...o });
const p = (...content: ArtifactDoc[]): ArtifactDoc => ({ type: "paragraph", content });
const t = (text: string): ArtifactDoc => ({ type: "text", text });

test("a project's artifacts in order; a move renumbers only what changed", () => {
  const all = [art("b", "c1", 1), art("a", "c1", 0), art("x", "c2", 0), art("c", "c1", 2)];
  assert.deepEqual(artifactsOf(all, "c1").map((a) => a.id), ["a", "b", "c"]);
  assert.deepEqual([...moveKeys(all, "c", 0)], [["c", 0], ["a", 1], ["b", 2]]);
  assert.deepEqual([...moveKeys(all, "a", 1)], [["b", 0], ["a", 1]]);
  assert.equal(moveKeys(all, "b", 1).size, 0, "already there");
  assert.deepEqual([...moveKeys(all, "a", 99)], [["b", 0], ["c", 1], ["a", 2]], "past the end: last");
  // equal keys (two devices added at once) still give a definite order
  const tied = [art("p", "c", 0), art("q", "c", 0)];
  assert.deepEqual([...moveKeys(tied, "q", 0)], [["p", 1]]);
});

test("preview text: blocks apart, marks dropped, cut with an ellipsis", () => {
  const doc: ArtifactDoc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [t("Plan")] },
      p(t("First "), { type: "text", text: "bold", marks: [{ type: "bold" }] }),
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("one"))] }, { type: "listItem", content: [p(t("two"))] }] },
    ],
  };
  assert.equal(docText(doc), "Plan First bold one two");
  assert.equal(docText(doc, 9), "Plan Firs…");
  assert.equal(docText(null), "");
});

test("data: images never stay in a document; uploaded and web ones do", () => {
  const img = (src: string): ArtifactDoc => ({ type: "image", attrs: { src } });
  const doc: ArtifactDoc = { type: "doc", content: [p(t("a"), img("data:image/png;base64,AAAA")), img("/api/artifacts/media?name=abc.png"), img("https://example.com/x.png"), img("javascript:alert(1)")] };
  assert.deepEqual(docImages(withoutInlineImages(doc)), ["/api/artifacts/media?name=abc.png", "https://example.com/x.png"]);
  const clean: ArtifactDoc = { type: "doc", content: [p(t("a"))] };
  assert.equal(withoutInlineImages(clean), clean, "untouched when there's nothing to take out");
});

test("edited label: minutes, hours, yesterday, then the date", () => {
  const now = new Date(2026, 9, 18, 15, 0).getTime();
  assert.equal(editedLabel(now - 20_000, now), "just now");
  assert.equal(editedLabel(now - 5 * 60_000, now), "5m ago");
  assert.equal(editedLabel(now - 3 * 3_600_000, now), "3h ago");
  assert.equal(editedLabel(new Date(2026, 9, 18, 1, 0).getTime(), now), "14h ago", "earlier today");
  assert.equal(editedLabel(new Date(2026, 9, 17, 23, 0).getTime(), now), "yesterday");
  assert.equal(editedLabel(new Date(2026, 9, 2).getTime(), now), "10/2");
  assert.equal(editedLabel(new Date(2025, 11, 30).getTime(), now), "2025/12/30");
});

test("canvas: each project's nodes level with its card, pushed down past the previous project's", () => {
  // node 80 tall, 90 per node, 20 between projects
  const { tops, bottom } = stackGroups(
    [
      { id: "a", top: 0, count: 3 }, // runs to 260
      { id: "b", top: 100, count: 1 }, // pushed to 280
      { id: "c", top: 500, count: 0 }, // nothing to place: stays level
      { id: "d", top: 600, count: 2 },
    ],
    80,
    90,
    20,
  );
  assert.deepEqual(tops, [0, 280, 500, 600]);
  assert.equal(bottom, 790);
});

test("store: add at the end, edit stamps updatedAt, move keeps it, delete", () => {
  useSync.setState({ artifacts: [] });
  const s = () => useSync.getState();
  const a = s().addArtifact("c1", "Brief");
  const b = s().addArtifact("c1");
  assert.deepEqual(artifactsOf(s().artifacts, "c1").map((x) => x.id), [a, b]);
  const before = s().artifacts.find((x) => x.id === b)!.updatedAt;
  s().moveArtifact(b, 0);
  assert.deepEqual(artifactsOf(s().artifacts, "c1").map((x) => x.id), [b, a]);
  assert.equal(s().artifacts.find((x) => x.id === b)!.updatedAt, before, "a move isn't an edit");
  s().updateArtifact(a, { title: "Brief v2", body: { type: "doc", content: [p(t("hi"))] } });
  const ed = s().artifacts.find((x) => x.id === a)!;
  assert.equal(ed.title, "Brief v2");
  assert.ok(ed.updatedAt >= before);
  s().deleteArtifact(a);
  assert.deepEqual(s().artifacts.map((x) => x.id), [b]);
});

test("store: a node placed freely keeps its spot; moved in line (shift-drag) it goes back to the line", () => {
  useSync.setState({ artifacts: [] });
  const s = () => useSync.getState();
  const a = s().addArtifact("c1");
  const b = s().addArtifact("c1");
  const before = s().artifacts.find((x) => x.id === b)!.updatedAt;
  s().placeArtifact(b, { x: 40.4, y: -12 });
  let me = s().artifacts.find((x) => x.id === b)!;
  assert.deepEqual([me.x, me.y], [40, -12]);
  assert.equal(me.updatedAt, before, "placing isn't an edit");
  s().placeArtifact(b, { x: -30, y: 5 });
  assert.equal(s().artifacts.find((x) => x.id === b)!.x, 0, "never left of the column");
  s().moveArtifact(b, 1); // already last: the order stays, the spot goes
  me = s().artifacts.find((x) => x.id === b)!;
  assert.equal(me.x, undefined);
  assert.equal(me.y, undefined);
  assert.deepEqual(artifactsOf(s().artifacts, "c1").map((x) => x.id), [a, b]);
});

test("deleting a project sends its artifacts' tombstones; finishing it keeps them", () => {
  useSync.setState({ campaigns: [{ id: "c1", name: "P", activityIds: [], tags: [], createdAt: 0 }, { id: "c2", name: "Q", activityIds: [], tags: [], createdAt: 0 }], artifacts: [art("a1", "c1", 0), art("a2", "c1", 1), art("b1", "c2", 0)] });
  let prev = useSync.getState();
  useSync.getState().updateCampaign("c1", { done: true });
  assert.equal(useSync.getState().artifacts.length, 3, "a finished project keeps its artifacts");
  prev = useSync.getState();
  useSync.getState().deleteCampaign("c1");
  const changes = diffState(prev as SyncState, useSync.getState(), 5).filter((c) => c.col === "artifacts");
  assert.deepEqual(changes.map((c) => [c.id, c.deleted]).sort(), [["a1", true], ["a2", true]]);
  assert.ok(changes.every(isSyncChange), "the server accepts the collection");
  assert.deepEqual(useSync.getState().artifacts.map((a) => a.id), ["b1"]);
});

test("an edit syncs as its fields; another device applies it", () => {
  useSync.setState({ artifacts: [art("a", "c", 0)] });
  const prev = useSync.getState();
  useSync.getState().updateArtifact("a", { body: { type: "doc", content: [p(t("x"))] } });
  const [c] = diffState(prev as SyncState, useSync.getState(), 9);
  assert.equal(c.col, "artifacts");
  assert.deepEqual(c.fields?.sort(), ["body", "updatedAt"]);
  const other = applyChanges({ ...prev, artifacts: [art("a", "c", 0)] } as SyncState, [c]);
  assert.equal(docText(other.artifacts![0].body), "x");
  // an older saved state without the collection takes it in too
  const old = applyChanges({ ...prev, artifacts: undefined } as unknown as SyncState, [c]);
  assert.equal(old.artifacts!.length, 1);
});

test("deleting an artifact can be undone and redone", async () => {
  useSync.setState({ artifacts: [art("keep", "c", 0)] });
  startUndo();
  await new Promise((r) => setTimeout(r, 350));
  useSync.getState().deleteArtifact("keep");
  assert.equal(useSync.getState().artifacts.length, 0);
  assert.equal(undo(), true);
  assert.equal(useSync.getState().artifacts[0]?.id, "keep");
  assert.equal(redo(), true);
  assert.equal(useSync.getState().artifacts.length, 0);
});

test("server: artifacts merge per field like other records", async () => {
  process.env.OTE_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "artifacts-"));
  const { syncUser } = await import("./server/syncdb");
  const u = "art";
  const a = art("d1", "c", 0, { title: "T", body: { type: "doc", content: [p(t("one"))] } });
  await syncUser(u, 0, [{ col: "artifacts", id: "d1", updatedAt: 10, data: a }]);
  // device B renames, device A (older copy) edits the body: both survive
  await syncUser(u, 0, [{ col: "artifacts", id: "d1", updatedAt: 20, data: { ...a, title: "Renamed" }, fields: ["title"] }]);
  const r = await syncUser(u, 0, [{ col: "artifacts", id: "d1", updatedAt: 30, data: { ...a, body: { type: "doc", content: [p(t("two"))] } }, fields: ["body"] }]);
  const got = r.changes.find((c) => c.id === "d1")!.data as Artifact;
  assert.equal(got.title, "Renamed");
  assert.equal(docText(got.body), "two");
  const del = await syncUser(u, 0, [{ col: "artifacts", id: "d1", updatedAt: 40, deleted: true }]);
  assert.equal(del.changes.find((c) => c.id === "d1")!.deleted, true);
});
