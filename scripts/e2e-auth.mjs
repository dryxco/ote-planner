// Auth gate e2e against a throwaway server started with:
//   SYNC_DATA_DIR=<tmp> SYNC_PASSWORD=test-pass SYNC_LOGIN_URL=http://127.0.0.1:3399 \
//   SYNC_ALLOWED_USERS=good-user SYNC_ALLOWED_TAILSCALE_USERS=phone@example.com next start -p 3302
// and scripts/mock-connector.mjs 3399.
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:3302";
const mock = process.argv[3] ?? "http://127.0.0.1:3399";
const browser = await chromium.launch();

// unauthenticated: page -> /login, API -> 401
let r = await fetch(base + "/", { redirect: "manual" });
assert.equal(r.status, 307);
const loc = new URL(r.headers.get("location"), base);
assert.equal(loc.pathname + loc.search, "/login?next=%2F");
r = await fetch(base + "/goals", { redirect: "manual", headers: { "x-forwarded-host": "box.tailnet.ts.net", "x-forwarded-proto": "https" } });
assert.equal(r.headers.get("location"), "https://box.tailnet.ts.net/login?next=%2Fgoals", "redirect keeps the public tailnet origin");
r = await fetch(base + "/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: '{"since":0,"changes":[]}' });
assert.equal(r.status, 401);
r = await fetch(base + "/api/calendar/events?start=0&end=1");
assert.equal(r.status, 401);
console.log("ok - no session: pages redirect to /login, APIs 401");

// tailnet requests from other accounts / tagged devices are refused outright
r = await fetch(base + "/login", { headers: { "tailscale-user-login": "stranger@example.org", "x-forwarded-for": "100.64.0.9" } });
assert.equal(r.status, 403);
r = await fetch(base + "/login", { headers: { "x-forwarded-for": "100.64.0.9" } });
assert.equal(r.status, 403);
r = await fetch(base + "/login", { headers: { "tailscale-user-login": "phone@example.com", "x-forwarded-for": "100.64.0.9" } });
assert.equal(r.status, 200);
console.log("ok - Tailscale gate: other account / tagged device 403, allowed account 200");

async function deviceLogin(userId, email) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base + "/calendar");
  assert.ok(page.url().includes("/login?next=%2Fcalendar"));
  await page.getByRole("button", { name: "Sign in with your server" }).click();
  const userCode = (await page.locator("[data-user-code]").innerText()).trim();
  await fetch(mock + "/_approve", { method: "POST", body: JSON.stringify({ userCode, userId, email }) });
  return { ctx, page };
}

// wrong password: refused; a device sign-in by someone not on SYNC_ALLOWED_USERS: refused
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.getByLabel("Password").fill("nope");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("Wrong password").waitFor();
  await ctx.close();
  const d = await deviceLogin("intruder", "someone@example.org");
  await d.page.getByText("isn't allowed to use Sync").waitFor();
  assert.equal((await d.ctx.cookies()).filter((c) => c.name === "sync_session").length, 0);
  await d.ctx.close();
  console.log("ok - wrong password and a not-allowed account are refused");
}

// allowed device sign-in -> lands on the page it asked for
{
  const { ctx, page } = await deviceLogin("good-user", "owner@example.com");
  await page.waitForURL(base + "/calendar");
  await ctx.close();
  console.log("ok - allowed account signs in with the device code");
}

// password -> lands on the page it asked for, APIs work, sign out ends it
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base + "/calendar");
  await page.getByLabel("Password").fill("test-pass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(base + "/calendar");
  await page.getByText("Calendar").first().waitFor();
  const cookie = (await ctx.cookies()).find((c) => c.name === "sync_session");
  assert.ok(cookie?.httpOnly, "session cookie is httpOnly");
  const sync = await page.evaluate(() => fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: '{"since":0,"changes":[]}' }).then((x) => x.status));
  assert.equal(sync, 200);
  console.log("ok - password signs in, returns to /calendar, APIs work");

  // sign out
  await page.goto(base + "/");
  await page.getByLabel("Settings").click();
  await page.getByText("Sign out").click();
  await page.waitForURL(/\/login/);
  const after = await page.evaluate(() => fetch("/api/auth/me").then((x) => x.status));
  assert.equal(after, 401);
  console.log("ok - sign out ends the session");
  await ctx.close();
}
console.log("auth e2e passed");
await browser.close();
