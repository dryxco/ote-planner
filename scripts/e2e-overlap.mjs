// Overlapping blocks share an hour row as stacked bands; alone they keep the full height; more than
// three at once show "+n", which lists the rest.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { at, isolateSync, plan, seed } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
await isolateSync(ctx);
const page = await ctx.newPage();
await seed(page, base, {
  plans: [
    plan("a", "Alpha", "work", "#2f7fd8", at(9, 0), at(10, 0)),
    plan("b", "Bravo", "exercise", "#e3933a", at(9, 30), at(10, 30)),
    // 13:00 row: four at once
    plan("c1", "C1", "work", "#2f7fd8", at(13, 0), at(13, 50)),
    plan("c2", "C2", "work", "#2f7fd8", at(13, 0), at(13, 50)),
    plan("c3", "C3", "work", "#2f7fd8", at(13, 0), at(13, 50)),
    plan("c4", "C4", "work", "#2f7fd8", at(13, 0), at(13, 50)),
  ],
});
const segBox = async (title, i = 0) => page.locator(`[data-column="plan"] [data-plan][title="${title}"]`).nth(i).boundingBox();
const aFull = await segBox("Alpha", 0); // 9:00–9:30, alone
const aBand = await segBox("Alpha", 1); // 9:30–10:00, shared
const bBand = await segBox("Bravo", 0); // 9:30–10:00, shared
const bFull = await segBox("Bravo", 1); // 10:00–10:30, alone
assert.ok(aFull.height > 20, `before the overlap: full height (${aFull.height})`);
assert.ok(aBand.height < 15 && bBand.height < 15, `only the overlapping 30 minutes are banded (${aBand.height}, ${bBand.height})`);
assert.ok(bBand.y > aBand.y + 5, "stacked: Bravo under Alpha");
assert.ok(Math.abs(aBand.x - bBand.x) < 2 && aBand.x > aFull.x + 20, "bands start where the overlap starts");
assert.ok(bFull.height > 20, `after the overlap: full height (${bFull.height})`);
console.log("ok - two overlapping plans: only the overlap is banded");

const chip = page.locator('[data-column="plan"] [data-lane-overflow]');
assert.equal(await chip.count(), 1);
assert.equal((await chip.innerText()).trim(), "+1");
await chip.click();
await page.locator("[data-overflow-list]").getByText("C4").click();
await page.getByText("Plan · Work").waitFor();
console.log("ok - four at once: three bands and +1 that lists the rest");
console.log("overlap e2e passed");
await browser.close();
