// The Meals tab: photos (camera on phones, or picked from Photos) become meals, split by when they were
// taken; what's in them is read on the server (here a canned reading: OTE_MEAL_FAKE, never Claude) and
// can be fixed by hand; the day shares as one picture. Meals sync like other records.
// Server (THROWAWAY data dir, never the real .data or port 3000):
//   OTE_DATA_DIR=$(mktemp -d) OTE_DISABLE_JOBS=1 OTE_ALLOWED_USERS=test-user \
//     OTE_MEAL_FAKE='{"dishes":[{"name":"김치찌개","kcal":420},{"name":"공기밥","kcal":300}]}' next dev -p 3457
//   OTE_TEST_SESSION=$(node scripts/make-test-session.mjs $OTE_DATA_DIR test-user) OTE_TEST_BASE=http://localhost:3457 \
//     node scripts/e2e-meals.mjs http://localhost:3457 [screenshot dir]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";
import { store, withTestSession } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3457";
const shots = process.argv[3] ?? "/tmp/ote-meals-shots";
if (/:3000\b/.test(base)) throw new Error("refusing to run against the live server (port 3000)");
mkdirSync(shots, { recursive: true });
const cookie = `ote_session=${process.env.OTE_TEST_SESSION}`;
const api = async (path, body) => {
  const r = await fetch(base + path, { method: "POST", headers: { cookie, "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

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


/** Pick photos taken at the given times (today) into a file input. */
async function pickPhotos(page, input, photos) {
  await page.locator(input).evaluate((el, list) => {
    const dt = new DataTransfer();
    for (const p of list) {
      const bytes = Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0));
      const d = new Date();
      d.setHours(p.h, p.m, 0, 0);
      dt.items.add(new File([bytes], p.name, { type: "image/png", lastModified: d.getTime() }));
    }
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, photos);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  await withTestSession(ctx);
  const page = await ctx.newPage();
  await page.goto(base + "/login");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("sync-theme", "light");
  });
  await page.goto(base + "/meals");
  await page.locator("[data-meals-view]").waitFor();

  // the tab bar has Meals and still fits
  await page.getByRole("link", { name: "Meals" }).first().waitFor();
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, "no sideways scroll");
  // the camera button opens the camera straight away
  assert.equal(await page.locator("[data-meal-camera-input]").getAttribute("capture"), "environment");
  assert.equal(await page.locator("[data-share-day]").isDisabled(), true, "nothing to share yet");
  console.log("ok - a Meals tab; Take photo opens the camera");

  // 1) three photos from Photos: two at 8:00 / 8:20 (one breakfast), one at 12:30 (lunch)
  const b64 = (c) => png(640, 480, c).toString("base64");
  await pickPhotos(page, "[data-meal-album-input]", [
    { name: "a.png", h: 8, m: 0, b64: b64([200, 90, 60]) },
    { name: "b.png", h: 8, m: 20, b64: b64([240, 200, 80]) },
    { name: "c.png", h: 12, m: 30, b64: b64([70, 160, 90]) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll("[data-meal]").length === 2);
  await page.waitForFunction(() => document.querySelectorAll("[data-meal-reading]").length === 0 && document.querySelectorAll("[data-dish]").length === 4);
  let st = await store(page);
  const meals = st.meals.sort((a, b) => a.at - b.at);
  assert.deepEqual(meals.map((m) => [m.kind, m.photos.length, new Date(m.at).getHours()]), [["breakfast", 2, 8], ["lunch", 1, 12]]);
  assert.ok(meals.every((m) => m.photos.every((p) => p.startsWith("/api/artifacts/media?name=") && p.endsWith(".jpg"))), "uploaded, as JPEG");
  assert.deepEqual(meals[0].dishes, [{ name: "김치찌개", kcal: 420 }, { name: "공기밥", kcal: 300 }]);
  assert.match(await page.locator("[data-day-kcal]").textContent(), /2 meals · about 1,440 kcal/);
  await page.screenshot({ path: `${shots}/meals-day.png`, fullPage: true });
  console.log("ok - photos split into meals by time, uploaded, and read (dishes + kcal filled in)");

  // 2) fixed by hand: a dish's calories, a new dish, the kind, a photo removed
  const first = page.locator(`[data-meal="${meals[0].id}"]`);
  const kcalField = first.locator('[data-dish] input[aria-label="Calories"]').nth(1);
  await kcalField.fill("250");
  await kcalField.press("Enter");
  await first.locator("[data-add-dish]").click();
  const name = first.locator('[data-dish] input[aria-label="Dish"]').nth(2);
  await name.fill("계란말이");
  await name.press("Enter");
  await first.locator('[data-dish] input[aria-label="Calories"]').nth(2).fill("150");
  await first.locator('[data-dish] input[aria-label="Calories"]').nth(2).press("Enter");
  await page.locator(`[data-meal="${meals[1].id}"] [data-meal-kind]`).selectOption("dinner");
  await first.getByRole("button", { name: "Remove photo" }).first().click();
  await page.waitForTimeout(300);
  st = await store(page);
  const m0 = st.meals.find((m) => m.id === meals[0].id);
  assert.deepEqual(m0.dishes, [{ name: "김치찌개", kcal: 420 }, { name: "공기밥", kcal: 250 }, { name: "계란말이", kcal: 150 }]);
  assert.equal(m0.photos.length, 1);
  assert.equal(st.meals.find((m) => m.id === meals[1].id).kind, "dinner");
  assert.match(await first.locator("[data-meal-kcal]").textContent(), /820 kcal/);
  console.log("ok - dishes, calories, kind and photos can be fixed by hand");

  // 3) it's on the server (synced)
  await page.waitForTimeout(1500);
  const onServer = (await api("/api/sync", { since: 0, changes: [] })).json.changes.filter((c) => c.col === "meals" && !c.deleted);
  assert.equal(onServer.length, 2, "both meals synced");
  assert.equal(onServer.find((c) => c.id === meals[0].id).data.dishes.length, 3);
  console.log("ok - meals sync to the server");

  // 4) share: one picture of the day (1080 wide), saved / shared as a PNG
  await page.locator("[data-share-day]").click();
  const preview = page.locator("[data-share-preview]");
  await preview.waitFor();
  await page.waitForFunction(() => document.querySelector("[data-share-preview]")?.naturalWidth > 0);
  const size = await preview.evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  assert.equal(size[0], 1080);
  await page.screenshot({ path: `${shots}/meals-share.png` });
  const card = await preview.evaluate(async (img) => {
    const r = await fetch(img.src);
    return Array.from(new Uint8Array(await r.arrayBuffer())).slice(0, 4);
  });
  assert.deepEqual(card, [0x89, 0x50, 0x4e, 0x47], "a PNG");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-share-save]").click()]);
  assert.match(download.suggestedFilename(), /^meals-\d{8}\.png$/);
  await download.saveAs(`${shots}/${download.suggestedFilename()}`);
  await page.keyboard.press("Escape");
  await page.locator("[data-share-sheet]").waitFor({ state: "detached" });
  console.log("ok - Share: the day as one picture, saved or sent through the share sheet");

  // 5) the reading endpoint takes only uploaded photos
  assert.equal((await api("/api/meals/read", { photos: ["../sync-test-user.json"] })).status, 400);
  assert.equal((await api("/api/meals/read", { photos: [] })).status, 400);
  const r = await fetch(base + "/api/meals/read", { method: "POST", headers: { cookie, "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ photos: [m0.photos[0]] }) });
  assert.equal(r.status, 403, "same origin only");
  console.log("ok - the reader takes only this app's uploaded photos, from this app");

  // 6) another day: empty; delete a meal (undo-able like other records)
  await page.getByRole("button", { name: "Day before" }).click();
  assert.match(await page.locator("[data-day-kcal]").textContent(), /Nothing logged yet/);
  await page.locator("[data-meals-date]").click();
  await page.locator(`[data-meal="${meals[1].id}"]`).getByRole("button", { name: "Delete meal" }).click();
  await page.locator("[data-meal-delete-confirm]").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-meal]").length === 1);
  console.log("ok - days to go back to; a meal deletes");
  console.log("meals e2e passed");
} finally {
  await browser.close();
}
