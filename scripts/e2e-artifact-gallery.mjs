// Artifacts on their own and in one place: the Artifacts button on the Projects tab shows every artifact
// (newest edits first, each with its project), filters by project / "No project", and starts one that
// isn't in a project; the editor's project picker moves one into a project (onto its canvas) and out.
// Server (THROWAWAY data dir, never the real .data or port 3000):
//   OTE_DATA_DIR=$(mktemp -d) OTE_DISABLE_JOBS=1 OTE_ALLOWED_USERS=test-user next dev -p 3457
//   OTE_TEST_SESSION=$(node scripts/make-test-session.mjs $OTE_DATA_DIR test-user) OTE_TEST_BASE=http://localhost:3457 \
//     node scripts/e2e-artifact-gallery.mjs http://localhost:3457 [screenshot dir]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { store, withTestSession } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3457";
const shots = process.argv[3] ?? "/tmp/ote-artifact-gallery-shots";
if (/:3000\b/.test(base)) throw new Error("refusing to run against the live server (port 3000)");
mkdirSync(shots, { recursive: true });

const now = Date.now();
const doc = (t) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const art = (id, campaignId, title, ago) => ({ id, campaignId, title, body: doc(`${title} notes`), order: 0, createdAt: now - 9e6, updatedAt: now - ago });
const seedState = {
  campaigns: [
    { id: "c1", name: "Launch site", activityIds: [], tags: [], createdAt: now - 1000 },
    { id: "c2", name: "Move house", activityIds: [], tags: [], createdAt: now - 900 },
  ],
  artifacts: [art("a1", "c1", "Brief", 3600e3), art("a2", "c2", "Packing list", 60e3), art("a3", "", "Reading list", 600e3)],
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await withTestSession(ctx);
  const page = await ctx.newPage();
  await page.goto(base + "/login");
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("sync-theme", "dark");
    localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: s }));
  }, seedState);
  await page.goto(base + "/projects");
  await page.locator("[data-artifact-canvas]").waitFor();
  assert.equal(await page.locator('[data-artifact-node="a3"]').count(), 0, "one on its own isn't on the canvas");

  // 1) the button on the header's right: every artifact, newest edits first, each with its project
  const btn = page.locator("[data-artifacts-view]");
  const hb = await btn.boundingBox();
  assert.ok(hb.x > 1440 / 2, "on the right of the header");
  await btn.click();
  await page.locator("[data-artifact-gallery]").waitFor();
  assert.equal(await page.locator("header h1").first().textContent(), "Artifacts");
  const ids = await page.locator("[data-gallery-item]").evaluateAll((els) => els.map((e) => e.dataset.galleryItem));
  assert.deepEqual(ids, ["a2", "a3", "a1"], "newest edits first");
  assert.match(await page.locator('[data-gallery-item="a3"]').textContent(), /No project/);
  assert.match(await page.locator('[data-gallery-item="a1"]').textContent(), /Launch site/);
  await page.screenshot({ path: `${shots}/gallery.png` });
  console.log("ok - the Artifacts button shows every artifact, newest first, with its project");

  // 2) shelves: No project / one project
  await page.locator('[data-shelf="none"]').click();
  assert.deepEqual(await page.locator("[data-gallery-item]").evaluateAll((els) => els.map((e) => e.dataset.galleryItem)), ["a3"]);
  await page.locator('[data-shelf="c1"]').click();
  assert.deepEqual(await page.locator("[data-gallery-item]").evaluateAll((els) => els.map((e) => e.dataset.galleryItem)), ["a1"]);
  await page.locator('[data-shelf="all"]').click();
  console.log("ok - filter by project or the ones on their own");

  // 3) a new one on its own (from "All"): no project; kept once it has a title
  await page.locator("[data-new-artifact]").click();
  const ed = page.locator("[data-artifact-editor]");
  await ed.waitFor();
  assert.match(await ed.locator("header").textContent(), /No project/);
  await page.keyboard.type("Ideas");
  await page.locator("[data-artifact-status]", { hasText: "Saved" }).waitFor();
  await page.waitForTimeout(900);
  let st = await store(page);
  const mine = st.artifacts.find((a) => a.title === "Ideas");
  assert.equal(mine.campaignId, "", "on its own");

  // 4) the picker moves it into a project: it's on that project's canvas then
  await ed.locator("[data-artifact-project]").selectOption("c2");
  await page.waitForTimeout(300);
  st = await store(page);
  assert.equal(st.artifacts.find((a) => a.id === mine.id).campaignId, "c2");
  assert.match(await ed.locator("header").textContent(), /Move house/);
  await page.keyboard.press("Escape");
  await page.locator('[data-gallery-item="' + mine.id + '"]', { hasText: "Move house" }).waitFor();
  // the view is remembered; back to the projects
  await page.reload();
  await page.locator("[data-artifact-gallery]").waitFor();
  await btn.click();
  await page.locator(`[data-artifact-node="${mine.id}"]`).waitFor();
  console.log("ok - start one on its own; the editor's picker moves it into a project (onto its canvas)");

  // 5) and out again
  await page.locator(`[data-artifact-node="${mine.id}"]`).click();
  await ed.locator("[data-artifact-project]").selectOption("");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(`[data-artifact-node="${mine.id}"]`).count(), 0, "off the canvas");
  st = await store(page);
  assert.equal(st.artifacts.find((a) => a.id === mine.id).campaignId, "");

  // 6) phones: the same button and gallery
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await withTestSession(phone);
  const p2 = await phone.newPage();
  await p2.goto(base + "/login");
  await p2.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: s }));
  }, seedState);
  await p2.goto(base + "/projects");
  await p2.locator("[data-artifacts-view]").tap();
  await p2.locator('[data-gallery-item="a3"]').waitFor();
  const w = await p2.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 390, "no sideways scroll on a phone");
  await p2.screenshot({ path: `${shots}/gallery-phone.png` });
  console.log("ok - phones: the same view");
  console.log("artifact gallery e2e passed");
} finally {
  await browser.close();
}
