// Agent chat: the server (started with SYNC_AGENT_FAKE) returns a canned {reply, ops}; the app applies
// the ops, shows what it did, and Undo reverts them as one step.
// usage: SYNC_AGENT_FAKE='{"reply":"Added","ops":[{"op":"add_plan","name":"Gym","activity":"Exercise","start":"2026-10-09T07:00","end":"2026-10-09T08:00"},{"op":"add_todo","name":"Buy milk"},{"op":"delete_plan","id":"nope"}]}' next start …; node scripts/e2e-agent.mjs <base>
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { isolateSync, seed } from "./grid-helpers.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
await isolateSync(ctx);
const page = await ctx.newPage();
await seed(page, base, {});
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("sync-store-v1")).state);

assert.equal(await page.getByLabel("Add", { exact: true }).count(), 0, "the + button is replaced");
await page.getByLabel("Agent chat").click();
await page.getByLabel("Message the agent").fill("gym tomorrow 7am for an hour, and a to-do: buy milk");
await page.keyboard.press("Enter");
await page.getByText("Added").waitFor();
let s = await state();
const gym = s.plans.find((p) => p.name === "Gym");
assert.ok(gym, "plan added");
assert.equal(gym.activityId, "exercise", "activity resolved by name");
assert.equal(new Date(gym.start).getHours(), 7);
assert.equal(gym.end - gym.start, 3600e3);
assert.ok(s.todos.find((t) => t.name === "Buy milk" && t.date === undefined), "undated to-do added");
const results = await page.locator("[data-agent-results]").innerText();
assert.match(results, /✓ plan "Gym"/);
assert.match(results, /✗ delete_plan: no plan nope/, "bad ops are skipped and reported");
const box = await page.locator("[data-agent-chat]").boundingBox();
assert.ok(box.x >= 0 && box.x + box.width <= 393, `panel stays on screen (${box.x}, ${box.width})`);
console.log("ok - agent ops applied (and invalid ones reported)");

await page.locator("[data-agent-results]").getByRole("button", { name: "Undo" }).click();
s = await state();
assert.equal(s.plans.filter((p) => p.name === "Gym").length, 0, "undo removes the plan");
assert.equal(s.todos.filter((t) => t.name === "Buy milk").length, 0, "…and the to-do, in one step");
console.log("ok - Undo reverts the agent's changes in one step");
// a tap anywhere else closes the panel
await page.locator("[data-timeline-scroll]").click({ position: { x: 5, y: 300 } });
assert.equal(await page.locator("[data-agent-chat]").count(), 0, "closed by an outside tap");
await page.getByLabel("Agent chat").click();
// paste a screenshot into the input: a thumbnail appears and it's sent with the message
await page.getByLabel("Message the agent").focus();
await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 40;
  c.height = 30;
  c.getContext("2d").fillRect(0, 0, 40, 30);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
  document.querySelector('[aria-label="Message the agent"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.locator("[data-agent-pasted] img").waitFor();
await page.getByRole("button", { name: "Send" }).click();
await page.getByText("(1 image: image/jpeg)").waitFor();
assert.equal(await page.locator("[data-agent-pasted]").count(), 0, "cleared after sending");
console.log("ok - pasted image is sent with the message");
// phones (no fine pointer): a photo button next to Send picks images from the library
{
  const m = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
  await isolateSync(m);
  const mp = await m.newPage();
  await seed(mp, base, {});
  await mp.getByLabel("Agent chat").click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await mp.locator("[data-agent-photo]").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: png });
  await mp.locator("[data-agent-pasted] img").waitFor();
  console.log("ok - photo button on phones");
  await m.close();
}
console.log("agent e2e passed");
await browser.close();
