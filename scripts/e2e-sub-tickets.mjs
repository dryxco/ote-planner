// Tickets under tasks: in a project folder, drop a ticket on a task and it sits under it (indented, with
// a line down from the task); drop it on the folder and it comes out again. A task that's done keeps only
// done tickets under it (open work stays in sight). It's Ote's own link (never sent to a connector) and syncs.
// Server (THROWAWAY data dir, never the real .data or port 3000):
//   OTE_DATA_DIR=$(mktemp -d) OTE_DISABLE_JOBS=1 OTE_ALLOWED_USERS=test-user next dev -p 3457
//   OTE_TEST_SESSION=$(node scripts/make-test-session.mjs $OTE_DATA_DIR test-user) OTE_TEST_BASE=http://localhost:3457 \
//     node scripts/e2e-sub-tickets.mjs http://localhost:3457 [screenshot dir]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { store, withTestSession } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3457";
const shots = process.argv[3] ?? "/tmp/ote-sub-tickets-shots";
if (/:3000\b/.test(base)) throw new Error("refusing to run against the live server (port 3000)");
mkdirSync(shots, { recursive: true });

const now = Date.now();
const ticket = (id, title, group, status) => ({ id, projectId: "local:p", local: true, title, status, statusGroup: group, createdAt: now - Number(id.slice(1)) * 1000, campaignId: "c1" });
const seedState = {
  campaigns: [{ id: "c1", name: "Character", activityIds: [], tags: [], createdAt: now - 1000 }],
  todos: [
    { id: "t1", name: "[Character] Consistency", activityId: "work", color: "#2f7fd8", done: false, createdAt: now - 1000, campaignId: "c1" },
    { id: "t2", name: "Shipped bit", activityId: "work", color: "#2f7fd8", done: true, doneAt: now - 500, createdAt: now - 900, campaignId: "c1" },
  ],
  tickets: [ticket("k1", "[Character] Sheet 제안 UI 수정", "to_do", "시작 전"), ticket("k2", "[Character] Consistency 적용 안되는 문제 해결", "in_progress", "진행 중"), ticket("k3", "Old fix", "complete", "완료")],
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await withTestSession(ctx);
  const page = await ctx.newPage();
  await page.goto(base + "/login");
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("sync-theme", "light");
    localStorage.setItem("sync-open-projects", JSON.stringify(["c1"]));
    localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: s }));
  }, seedState);
  await page.goto(base + "/projects");
  const folder = page.locator('[data-project="c1"]');
  const row = (title) => folder.getByText(title, { exact: true });
  await row("[Character] Sheet 제안 UI 수정").waitFor();
  const parentOf = async (id) => (await store(page)).tickets.find((t) => t.id === id).parentTodoId;

  // 1) drop two tickets on the task: they sit under it
  await row("[Character] Sheet 제안 UI 수정").dragTo(row("[Character] Consistency"));
  await row("[Character] Consistency 적용 안되는 문제 해결").dragTo(row("[Character] Consistency"));
  const sub = page.locator('[data-sub-tickets="t1"]');
  await sub.getByText("[Character] Sheet 제안 UI 수정").waitFor();
  await sub.getByText("[Character] Consistency 적용 안되는 문제 해결").waitFor();
  assert.equal(await parentOf("k1"), "t1");
  assert.equal(await parentOf("k2"), "t1");
  const taskBox = await row("[Character] Consistency").boundingBox();
  const kidBox = await sub.getByText("[Character] Sheet 제안 UI 수정").boundingBox();
  assert.ok(kidBox.y > taskBox.y && kidBox.x > taskBox.x + 8, "under the task, indented");
  await folder.screenshot({ path: `${shots}/folder-sub-tickets.png` });
  console.log("ok - a ticket dropped on a task sits under it");

  // 2) it survives a reload, and it's on the server (synced), never sent to a connector
  await page.waitForTimeout(1500);
  await page.reload();
  await page.locator('[data-sub-tickets="t1"]').getByText("[Character] Sheet 제안 UI 수정").waitFor();
  const cookie = `ote_session=${process.env.OTE_TEST_SESSION}`;
  const all = await (await fetch(base + "/api/sync", { method: "POST", headers: { cookie, "content-type": "application/json", origin: base }, body: JSON.stringify({ since: 0, changes: [] }) })).json();
  assert.equal(all.changes.find((c) => c.col === "tickets" && c.id === "k1")?.data?.parentTodoId, "t1", "synced to the server");
  console.log("ok - kept after a reload, and synced");

  // 3) dropped on the folder's header: out from under the task, still in the project
  await page.locator('[data-sub-tickets="t1"]').getByText("[Character] Sheet 제안 UI 수정").dragTo(folder.locator("header"));
  await page.waitForFunction(() => !document.querySelector('[data-sub-tickets="t1"]')?.textContent?.includes("Sheet 제안"));
  assert.equal(await parentOf("k1"), undefined);
  assert.equal((await store(page)).tickets.find((t) => t.id === "k1").campaignId, "c1", "still in the project");
  console.log("ok - dropped on the folder, it comes out from under the task");

  // 4) a done task keeps only done tickets under it: an open one stays in sight
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("sync-store-v1"));
    for (const t of raw.state.tickets) if (t.id === "k1" || t.id === "k3") t.parentTodoId = "t2";
    localStorage.setItem("sync-store-v1", JSON.stringify(raw));
  });
  await page.reload();
  await row("[Character] Sheet 제안 UI 수정").waitFor();
  assert.equal(await page.locator('[data-sub-tickets="t2"]').count(), 0, "done list closed: nothing under t2 shown");
  assert.equal(await page.locator('[data-sub-tickets] >> text="[Character] Sheet 제안 UI 수정"').count(), 0, "the open ticket stands on its own");
  await folder.getByRole("button", { name: /^Done/ }).click();
  await page.locator('[data-sub-tickets="t2"]').getByText("Old fix").waitFor();
  console.log("ok - a done task keeps only its done tickets under it");
  console.log("sub-tickets e2e passed");
} finally {
  await browser.close();
}
