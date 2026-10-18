// Artifacts: documents linked to projects. On computers they're nodes right of the project folders,
// joined by curves to a port on the card; a node opens the document editor (headings, lists,
// checklists, links, marks, quotes, dividers, uploaded images). Edits autosave and sync to another
// device; nodes reorder by drag (a straight drop line); phones list them under the project; deleting
// a project takes its artifacts with it.
// Server (THROWAWAY data dir, never the real .data or port 3000):
//   OTE_DATA_DIR=$(mktemp -d) OTE_DISABLE_JOBS=1 OTE_ALLOWED_USERS=test-user next dev -p 3457   (or next start)
//   OTE_TEST_SESSION=$(node scripts/make-test-session.mjs $OTE_DATA_DIR test-user) OTE_TEST_BASE=http://localhost:3457 \
//     node scripts/e2e-artifacts.mjs http://localhost:3457 [screenshot dir]
// (localhost, not 127.0.0.1: next dev blocks its dev resources for other hosts.) Use a fresh data dir per run.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";
import { store, withTestSession } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3457";
const shots = process.argv[3] ?? "/tmp/sync-artifacts-shots";
if (/:3000\b/.test(base)) throw new Error("refusing to run against the live server (port 3000)");
mkdirSync(shots, { recursive: true });
const cookie = `ote_session=${process.env.OTE_TEST_SESSION}`;
const api = async (path, body) => {
  const r = await fetch(base + path, { method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json", origin: base }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) };
};
const serverArtifacts = async () => (await api("/api/sync", { since: 0, changes: [] })).json.changes.filter((c) => c.col === "artifacts");

/** A small solid PNG (w×h, one colour). */
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const now = Date.now();
const camp = (id, name, o = {}) => ({ id, name, activityIds: [], tags: [], createdAt: now - 1000, ...o });
const doc = (...paras) => ({ type: "doc", content: paras.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) });
const seedState = {
  campaigns: [camp("c-launch", "Launch site", { due: now + 5 * 86400e3 }), camp("c-health", "건강한 삶", { due: now + 9 * 86400e3 }), camp("c-move", "Move house", { due: now + 20 * 86400e3 })],
  artifacts: [
    { id: "a-brief", campaignId: "c-launch", title: "Brief", body: doc("Goals for the launch: a calm landing page, signup that works on phones."), order: 0, createdAt: now - 5000, updatedAt: now - 3 * 3600e3 },
    { id: "a-copy", campaignId: "c-launch", title: "Copy draft", body: doc("Headline options and the three feature blurbs."), order: 1, createdAt: now - 4000, updatedAt: now - 20 * 60e3 },
    { id: "a-checklist", campaignId: "c-launch", title: "Launch checklist", body: null, order: 2, createdAt: now - 3000, updatedAt: now - 86400e3 },
  ],
  todos: [{ id: "t1", name: "Write the hero copy", activityId: "work", color: "#2f7fd8", done: false, createdAt: now - 1000, campaignId: "c-launch" }],
};

async function open(ctx, path, state, theme = "dark") {
  const page = await ctx.newPage();
  await page.goto(base + "/login");
  await page.evaluate(
    ({ s, theme }) => {
      localStorage.clear();
      localStorage.setItem("sync-theme", theme);
      if (s) localStorage.setItem("sync-store-v1", JSON.stringify({ version: 1, state: s }));
    },
    { s: state, theme },
  );
  await page.goto(base + path);
  return page;
}

const browser = await chromium.launch();
try {
  // ---- desktop: the canvas
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await withTestSession(desk);
  let page = await open(desk, "/projects", seedState);
  await page.locator("[data-artifact-canvas]").waitFor();
  await page.locator('[data-artifact-node="a-brief"]').waitFor();
  const card = await page.locator('[data-project="c-launch"]').boundingBox();
  const nodes = await Promise.all(["a-brief", "a-copy", "a-checklist"].map((id) => page.locator(`[data-artifact-node="${id}"]`).boundingBox()));
  assert.ok(nodes[0].x > card.x + card.width + 40, "nodes sit right of the card");
  assert.ok(Math.abs(nodes[0].y - card.y) < 4, "the first node is level with its card");
  assert.ok(nodes[1].y > nodes[0].y + nodes[0].height && nodes[2].y > nodes[1].y, "stacked in order");
  // each node has a curve from the card's port
  const curves = await page.locator("[data-curve]").evaluateAll((ps) => ps.map((p) => ({ id: p.dataset.curve, d: p.getAttribute("d") })));
  assert.deepEqual(curves.map((c) => c.id).sort(), ["a-brief", "a-checklist", "a-copy"]);
  assert.ok(curves.every((c) => / C /.test(c.d)), "bezier curves");
  const port = await page.locator(`[data-project="c-launch"]`).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const p = [...document.querySelectorAll("[data-port]")].map((x) => x.getBoundingClientRect()).find((b) => b.top > r.top && b.top < r.top + 40);
    return p && { cx: p.left + p.width / 2, right: r.right };
  });
  assert.ok(port && Math.abs(port.cx - port.right) < 2, "the port sits on the card's right edge");
  const second = await page.locator('[data-project="c-health"]').boundingBox();
  assert.ok(second.y < nodes[2].y + nodes[2].height, "(the next project starts beside the first one's nodes...)");
  console.log("ok - canvas: nodes beside their project, joined by curves to a port on the card");
  await page.screenshot({ path: `${shots}/desktop-dark-canvas.png` });
  // a small computer screen: the folders narrow, the nodes still fit
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(300);
  const small = await page.locator('[data-artifact-node="a-brief"]').boundingBox();
  assert.ok(small.x + small.width <= 1024 - 8, "nodes fit a 1024px window");
  await page.screenshot({ path: `${shots}/desktop-1024-dark-canvas.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  // drag the last node to the top: a straight line marks the spot, the order follows
  const from = nodes[2];
  await page.mouse.move(from.x + 60, from.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + 60, from.y + 40 - (i * (from.y - nodes[0].y + 10)) / 8);
  const line = page.locator("[data-drop-line]");
  await line.waitFor();
  const lineBox = await line.boundingBox();
  const lineStyle = await line.evaluate((el) => ({ radius: getComputedStyle(el).borderRadius, shadow: getComputedStyle(el).boxShadow }));
  assert.equal(Math.round(lineBox.height), 2, "a 2px line");
  assert.equal(lineStyle.radius, "0px", "straight, not rounded");
  assert.equal(lineStyle.shadow, "none");
  assert.ok(lineBox.y < nodes[0].y && lineBox.y > nodes[0].y - 12, "above the first node");
  await page.screenshot({ path: `${shots}/desktop-dark-drag.png` });
  await page.mouse.up();
  await page.waitForTimeout(200);
  let st = await store(page);
  const order = st.artifacts.filter((a) => a.campaignId === "c-launch").sort((a, b) => a.order - b.order).map((a) => a.id);
  assert.deepEqual(order, ["a-checklist", "a-brief", "a-copy"]);
  assert.equal(await page.locator("[data-artifact-editor]").count(), 0, "a drag doesn't open it");
  console.log("ok - drag reorders nodes (a straight 2px drop line)");

  // a new artifact from the port of an empty project; the editor opens on its title
  const healthPort = await page.locator('[data-project="c-health"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const i = [...document.querySelectorAll("[data-port]")].findIndex((x) => {
      const b = x.getBoundingClientRect();
      return b.top > r.top && b.top < r.top + 40;
    });
    return i;
  });
  const portBtn = page.locator("[data-port]").nth(healthPort);
  await portBtn.hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/desktop-dark-port-hover.png`, clip: { x: card.x + card.width - 200, y: second.y - 20, width: 520, height: 120 } });
  await portBtn.click();
  const ed = page.locator("[data-artifact-editor]");
  await ed.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-artifact-title")), true, "title focused");
  await page.keyboard.type("Weekly plan");
  await page.keyboard.press("Enter");
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.type("# Morning");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Run ");
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type("5 km");
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type(" then ");
  await page.keyboard.press(`${mod}+i`);
  await page.keyboard.type("stretch");
  await page.keyboard.press(`${mod}+i`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Shopping");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- oats");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("rolled, not instant");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("bananas");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1. Monday");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Thursday");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[ ] book the physio");
  await page.keyboard.press("Enter");
  await page.keyboard.type("call mum");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("> Rest is part of training.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("---");
  await page.keyboard.type("### Notes");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Use `ice` and ~~skip~~ nothing. Route: ");
  // ⌘K: a link on typed text
  await page.keyboard.press(`${mod}+k`);
  await page.locator("[data-link-bar] input").fill("example.com/route");
  await page.keyboard.press("Enter");
  // check the first checklist item
  await ed.locator('ul[data-type="taskList"] li input[type=checkbox]').first().check();
  // an image picked from disk, then one pasted
  await ed.locator("[data-artifact-file]").setInputFiles({ name: "pick.png", mimeType: "image/png", buffer: png(320, 120, [48, 176, 199]) });
  await ed.locator(".artifact-doc img").first().waitFor();
  await page.keyboard.press("ArrowRight"); // off the new image (a paste would replace a selected one)
  const pasted = png(200, 80, [227, 147, 58]).toString("base64");
  await ed.locator(".artifact-doc").evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "paste.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, pasted);
  await page.waitForFunction(() => document.querySelectorAll("[data-artifact-editor] .artifact-doc img").length === 2);
  await page.locator("[data-artifact-status]", { hasText: "Saved" }).waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${shots}/desktop-dark-editor.png` });

  st = await store(page);
  const mine = st.artifacts.find((a) => a.campaignId === "c-health");
  assert.equal(mine.title, "Weekly plan");
  const json = JSON.stringify(mine.body);
  for (const t of ['"heading"', '"level":1', '"level":2', '"level":3', '"bold"', '"italic"', '"code"', '"strike"', '"bulletList"', '"orderedList"', '"taskList"', '"checked":true', '"blockquote"', '"horizontalRule"', '"link"', "https://example.com/route", '"image"']) assert.ok(json.includes(t), `document has ${t}`);
  assert.ok(/"bulletList".*"bulletList"/.test(json), "a nested list");
  assert.ok(!json.includes("data:"), "no data: URLs in the record");
  const srcs = [...json.matchAll(/"src":"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(srcs.length, 2);
  assert.ok(srcs.every((s) => s.startsWith("/api/artifacts/media?name=")), "images are uploaded media");
  const img = await fetch(base + srcs[0], { headers: { cookie } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal(img.headers.get("x-content-type-options"), "nosniff");
  assert.match(img.headers.get("content-security-policy") ?? "", /sandbox/);
  console.log("ok - editor: headings, marks, nested / numbered / check lists, quote, divider, link, picked + pasted images (uploaded)");

  // the media endpoint: only images, only with the upload header, only same-origin
  const upload = (headers, body) => fetch(base + "/api/artifacts/media", { method: "POST", headers: { cookie, ...headers }, body });
  const form = (bytes, name) => {
    const f = new FormData();
    f.append("file", new Blob([bytes]), name);
    return f;
  };
  assert.equal((await upload({}, form(png(2, 2, [0, 0, 0]), "x.png"))).status, 415, "upload header required");
  assert.equal((await upload({ "x-sync-upload": "1", origin: "https://evil.example" }, form(png(2, 2, [0, 0, 0]), "x.png"))).status, 403, "cross-origin refused");
  assert.equal((await upload({ "x-sync-upload": "1" }, form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "x.svg"))).status, 415, "svg refused");
  assert.equal((await fetch(base + "/api/artifacts/media?name=../sync-test-user.json", { headers: { cookie } })).status, 404);
  assert.equal((await fetch(base + srcs[0])).status, 401, "media needs a session");
  console.log("ok - media: same-origin uploads of real images only; served only to a session");

  // closed: the node shows its title, a preview and when it was edited
  await page.keyboard.press("Escape");
  await ed.waitFor({ state: "detached" });
  const node = page.locator(`[data-artifact-node="${mine.id}"]`);
  await node.waitFor();
  const text = await node.innerText();
  assert.match(text, /Weekly plan/);
  assert.match(text, /Morning Run 5 km/);
  assert.match(text, /Edited just now/);
  await page.screenshot({ path: `${shots}/desktop-dark-canvas-after.png` });
  console.log("ok - node: title, preview, edited time");

  // synced to the server, and to another device
  await page.waitForTimeout(1500);
  const onServer = (await serverArtifacts()).find((c) => c.id === mine.id);
  assert.equal(onServer?.data.title, "Weekly plan");
  const other = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await withTestSession(other);
  const page2 = await open(other, "/projects", null, "light");
  await page2.locator(`[data-artifact-node="${mine.id}"]`).waitFor({ timeout: 15000 });
  await page2.locator('[data-artifact-node="a-brief"]').waitFor();
  await page2.waitForTimeout(400);
  await page2.screenshot({ path: `${shots}/desktop-light-canvas.png` });
  // edit there: the first device's open editor follows
  await page.locator(`[data-artifact-node="${mine.id}"]`).click();
  await ed.waitFor();
  await page2.locator(`[data-artifact-node="${mine.id}"]`).click();
  const ed2 = page2.locator("[data-artifact-editor]");
  await ed2.waitFor();
  await page2.waitForTimeout(300);
  await page2.screenshot({ path: `${shots}/desktop-light-editor.png` });
  await ed2.locator(".artifact-doc h1").click();
  await page2.keyboard.press("End");
  await page2.keyboard.type(" routine");
  await page2.locator("[data-artifact-status]", { hasText: "Saved" }).waitFor();
  await page.waitForFunction(() => document.querySelector("[data-artifact-editor] .artifact-doc h1")?.textContent === "Morning routine", null, { timeout: 15000 });
  console.log("ok - edits sync to another device (an open editor follows)");
  await page2.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // an artifact opened and left empty doesn't stay
  await page.locator('[data-project="c-move"] [data-add-artifact]').click();
  await ed.waitFor();
  await page.keyboard.press("Escape");
  await ed.waitFor({ state: "detached" });
  st = await store(page);
  assert.equal(st.artifacts.filter((a) => a.campaignId === "c-move").length, 0);
  console.log("ok - an untouched new artifact is dropped on close");

  // delete one from the editor (two steps)
  await page.locator('[data-artifact-node="a-copy"]').click();
  await ed.locator("[data-delete-artifact]").click();
  await ed.locator("[data-delete-artifact-confirm]").click();
  await ed.waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-artifact-node="a-copy"]').count(), 0);
  // ⌘Z (outside the editor) brings it back
  await page.locator("body").click({ position: { x: 1400, y: 880 } });
  await page.keyboard.press(`${mod}+z`);
  await page.locator('[data-artifact-node="a-copy"]').waitFor();
  console.log("ok - delete from the editor; undo brings it back");

  // ---- phones: artifacts listed under the project
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await withTestSession(phone);
  const p3 = await open(phone, "/projects", null, "dark");
  await p3.locator(`[data-artifact-row="${mine.id}"]`).waitFor({ timeout: 15000 });
  assert.equal(await p3.locator("[data-artifact-canvas]").count(), 0, "no canvas on phones");
  await p3.screenshot({ path: `${shots}/phone-dark-list.png` });
  await p3.locator(`[data-artifact-row="${mine.id}"]`).click();
  await p3.locator("[data-artifact-editor]").waitFor();
  await p3.waitForTimeout(400);
  const edBox = await p3.locator("[data-artifact-editor] [role=dialog]").boundingBox();
  assert.ok(edBox.width >= 389 && edBox.height >= 843, "full screen on a phone");
  await p3.screenshot({ path: `${shots}/phone-dark-editor.png` });
  await p3.evaluate(() => {
    localStorage.setItem("sync-theme", "light");
    window.__applyTheme?.();
  });
  await p3.waitForTimeout(200);
  await p3.screenshot({ path: `${shots}/phone-light-editor.png` });
  await p3.locator("[data-artifact-editor] [aria-label=Close]").click();
  await p3.screenshot({ path: `${shots}/phone-light-list.png` });
  console.log("ok - phones: a list under the project; the editor takes the screen");

  // deleting a project takes its artifacts (tombstones reach the server)
  await page.locator('[data-project="c-launch"]').getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Delete project" }).click();
  await page.getByRole("button", { name: "Delete with 3 artifacts" }).click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem("sync-store-v1")).state.artifacts.some((a) => a.campaignId === "c-launch"));
  await page.waitForTimeout(1500);
  const after = await serverArtifacts();
  for (const id of ["a-brief", "a-copy", "a-checklist"]) assert.equal(after.find((c) => c.id === id)?.deleted, true, `${id} tombstoned`);
  assert.equal(after.find((c) => c.id === mine.id)?.deleted, undefined, "other projects' stay");
  console.log("ok - deleting a project deletes its artifacts everywhere");
} finally {
  await browser.close();
}
console.log(`screenshots in ${shots}`);
