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
    { name: "b.png", h: 8, m: 20, b64: png(480, 900, [240, 200, 80]).toString("base64") }, // portrait
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

  // 2) fixed by hand: a dish's calories, the kind, a photo removed
  const first = page.locator(`[data-meal="${meals[0].id}"]`);
  const kcalField = first.locator('[data-dish] input[aria-label="Calories"]').nth(1);
  await kcalField.fill("250");
  await kcalField.press("Enter");
  await page.locator(`[data-meal="${meals[1].id}"] [data-meal-kind]`).selectOption("dinner");
  await first.getByRole("button", { name: "Remove photo" }).first().click();
  await page.waitForTimeout(300);
  st = await store(page);
  let m0 = st.meals.find((m) => m.id === meals[0].id);
  assert.deepEqual(m0.dishes, [{ name: "김치찌개", kcal: 420 }, { name: "공기밥", kcal: 250 }]);
  assert.equal(m0.photos.length, 1);
  assert.equal(st.meals.find((m) => m.id === meals[1].id).kind, "dinner");
  console.log("ok - calories, kind and photos can be fixed by hand");

  // 2b) + Dish: type what it was; its amount and calories are looked up (canned: 1개, 111 kcal)
  await first.locator("[data-add-dish]").click();
  const name = first.locator('[data-dish] input[aria-label="Dish"]').nth(2);
  assert.equal(await name.evaluate((el) => el === document.activeElement), true, "the new row is ready to type in");
  await name.fill("카페라떼 핫 한 잔");
  await name.press("Enter");
  await first.locator("[data-dish-basis]", { hasText: "1개 · test" }).waitFor();
  m0 = (await store(page)).meals.find((m) => m.id === meals[0].id);
  assert.deepEqual(m0.dishes[2], { name: "카페라떼 핫 한 잔", amount: "1개", kcal: 111, basis: "test", added: true });
  assert.match(await first.locator("[data-meal-kcal]").textContent(), /781 kcal/);
  // an empty new row left alone goes away
  await first.locator("[data-add-dish]").click();
  await page.locator("[data-meals-date]").click();
  await page.waitForTimeout(200);
  assert.equal((await store(page)).meals.find((m) => m.id === meals[0].id).dishes.length, 3);
  console.log("ok - a dish typed in gets its calories looked up");

  // 2c) Read again: what came from the photos is read anew; what was typed in stays
  await first.locator("[data-meal-reread]").click();
  await page.waitForFunction((id) => {
    const m = JSON.parse(localStorage.getItem("sync-store-v1")).state.meals.find((x) => x.id === id);
    return m.status === "done" && m.dishes[1].kcal === 300;
  }, meals[0].id);
  m0 = (await store(page)).meals.find((m) => m.id === meals[0].id);
  assert.deepEqual(m0.dishes.map((d) => d.name), ["김치찌개", "공기밥", "카페라떼 핫 한 잔"], "the typed-in dish is kept");
  console.log("ok - Read again keeps the dishes typed in by hand");

  // 3) it's on the server (synced)
  await page.waitForTimeout(1500);
  const onServer = (await api("/api/sync", { since: 0, changes: [] })).json.changes.filter((c) => c.col === "meals" && !c.deleted);
  assert.equal(onServer.length, 2, "both meals synced");
  assert.equal(onServer.find((c) => c.id === meals[0].id).data.dishes.length, 3, "with the typed-in one");
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
  // breakfast's photo is portrait now (the first one was removed): it stays in its box, the text
  // area under it is the white card, and the meal's time is on it
  const under = await preview.evaluate(async (img) => {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    return { belowPhoto: px(290, 236 + 344 + 14), inPhoto: px(290, 236 + 150) };
  });
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 4); // the photo went through JPEG
  assert.ok(near(under.belowPhoto, [255, 255, 255]), `white under the photo, not the photo (${under.belowPhoto})`);
  assert.ok(near(under.inPhoto, [240, 200, 80]), `the photo itself above (${under.inPhoto})`);
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

  // 7) a reading the phone drops (Safari: "Load failed") is tried again, then again when the page is back
  await page.locator("[data-meals-date]").click();
  let drops = 0;
  await page.route("**/api/meals/read", (route) => (drops++, route.abort("failed")));
  await pickPhotos(page, "[data-meal-album-input]", [{ name: "e.png", h: 15, m: 30, b64: b64([150, 120, 200]) }]);
  await page.locator("[data-meal-error]", { hasText: "Couldn't reach the server" }).waitFor({ timeout: 20000 });
  assert.equal(drops, 3, "tried 3 times before giving up for now");
  await page.unroute("**/api/meals/read");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(() => [...document.querySelectorAll("[data-meal]")].every((el) => !el.querySelector("[data-meal-error]") && !el.querySelector("[data-meal-reading]")));
  st = await store(page);
  const snack = st.meals.find((m) => new Date(m.at).getHours() === 15);
  assert.equal(snack.status, "done");
  assert.equal(snack.dishes.length, 2);
  console.log("ok - a dropped reading is retried, and read once the page is back");

  // 8) a page left open past midnight moves on to the new day (a photo taken then goes on that day)
  const night = await ctx.newPage();
  const late = new Date();
  late.setDate(late.getDate() + 1);
  late.setHours(23, 58, 0, 0);
  await night.clock.install({ time: late });
  await night.goto(base + "/meals");
  await night.locator("[data-meals-date]", { hasText: "Today" }).waitFor();
  await night.clock.fastForward("08:45:00"); // to 8:43 the next morning
  await night.locator("[data-meals-date]", { hasText: "Today" }).waitFor();
  await pickPhotos(night, "[data-meal-album-input]", [{ name: "m.png", h: 8, m: 43, b64: b64([210, 180, 120]) }]);
  await night.waitForFunction(() => document.querySelectorAll("[data-meal]").length === 1, null, { timeout: 20000 });
  const morning = (await store(night)).meals.find((m) => new Date(m.at).getHours() === 8 && new Date(m.at).getMinutes() === 43 && new Date(m.at).getDate() !== new Date(meals[0].at).getDate());
  const want = new Date(late.getTime() + 86400e3);
  assert.ok(morning, "the 8:43 photo is a meal");
  assert.equal(new Date(morning.at).getDate(), want.getDate(), "on the new day, not the day the page was opened");
  await night.close();
  console.log("ok - an open page moves on past midnight; a photo then goes on the new day");
  console.log("meals e2e passed");
} finally {
  await browser.close();
}
