// Connector e2e: Settings → Connector against scripts/mock-connector.mjs, through the real server.
// Server: SYNC_DATA_DIR=<tmp> SYNC_ALLOWED_USERS=good-user next start -p 3302 (jobs may be off:
// the test runs the sync with "Sync now"); mock: node scripts/mock-connector.mjs 3399.
// usage: SYNC_TEST_SESSION=$(node scripts/make-test-session.mjs <tmp> good-user) node scripts/e2e-connector.mjs <base> <mock>
import { chromium } from "playwright";
import assert from "node:assert/strict";

const [base = "http://127.0.0.1:3302", mock = "http://127.0.0.1:3399"] = process.argv.slice(2);
const cookie = `sync_session=${process.env.SYNC_TEST_SESSION}`;
const post = async (path, body) => {
  const r = await fetch(base + path, { method: "POST", headers: { cookie, "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (path) => (await fetch(base + path, { headers: { cookie } })).json();
const mockState = async () => (await fetch(mock + "/_state")).json();
await fetch(mock + "/_reset", { method: "POST" });

// connect through the Settings sheet
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
await ctx.addCookies([{ name: "sync_session", value: process.env.SYNC_TEST_SESSION, url: base }]);
const page = await ctx.newPage();
await page.goto(base + "/");
await page.getByLabel("Settings").click();
await page.getByLabel("Server URL").fill(mock);
await page.getByLabel("Token").fill("wrong");
await page.getByRole("button", { name: "Connect REST server" }).click();
await page.getByText(/bad token/).waitFor();
await page.getByLabel("Token").fill("test-token");
await page.getByRole("button", { name: "Connect REST server" }).click();
await page.getByText("owner@example.com").waitFor();
console.log("ok - a wrong token is refused; the right one connects");
await browser.close();
const st = await get("/api/connector/status");
assert.equal(st.connected, true);
assert.ok(!JSON.stringify(st).includes("test-token"), "the token never goes back to the browser");

// tasks: a to-do and a plan go out; one made on the board comes in
const now = Date.now();
const day = new Date();
day.setHours(0, 0, 0, 0);
await post("/api/sync", {
  since: 0,
  changes: [
    { col: "todos", id: "11111111-1111-4111-8111-111111111111", updatedAt: now, data: { id: "11111111-1111-4111-8111-111111111111", name: "Buy milk", activityId: "other", color: "#000", done: false, createdAt: now } },
    { col: "plans", id: "22222222-2222-4222-8222-222222222222", updatedAt: now, data: { id: "22222222-2222-4222-8222-222222222222", name: "Gym", activityId: "other", color: "#000", allDay: false, start: day.getTime() + 7 * 3600e3, end: day.getTime() + 8 * 3600e3, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: now } },
  ],
});
await fetch(mock + "/_task", { method: "POST", body: JSON.stringify({ id: "33333333-3333-4333-8333-333333333333", title: "From the board" }) });
await post("/api/connector/sync-now", {});
const s = await mockState();
assert.ok(s.tasks.some((t) => t.title === "Buy milk" && t.endTime === null));
assert.ok(s.tasks.some((t) => t.title === "Gym" && t.time === "07:00" && t.endTime === "08:00"));
const pulled = (await post("/api/sync", { since: 0, changes: [] })).body.changes;
assert.ok(pulled.some((c) => c.col === "todos" && c.data?.name === "From the board"));
console.log("ok - tasks: to-do and plan pushed, board task pulled");

// tickets: meta, file one, sheet detail / body / comment
const meta = await get("/api/connector/tickets/meta");
assert.equal(meta.projects[0].name, "Website");
await post("/api/sync", { since: 0, changes: [{ col: "tickets", id: "tk1", updatedAt: Date.now(), data: { id: "tk1", projectId: "web", title: "Fix header", status: "", createdAt: Date.now() } }] });
await post("/api/connector/sync-now", {});
const filed = (await mockState()).tickets.find((t) => t.title === "Fix header");
assert.equal(filed?.status, "Todo");
const ref = `db=${encodeURIComponent(filed.containerId)}&row=${encodeURIComponent(filed.id)}`;
const d = await get(`/api/connector/tickets/detail?${ref}`);
const body = JSON.stringify([{ type: "paragraph", content: "hello" }]);
assert.equal((await post("/api/connector/tickets/body", { db: filed.containerId, row: filed.id, body, base: d.updatedAt })).status, 200);
assert.equal((await post("/api/connector/tickets/body", { db: filed.containerId, row: filed.id, body, base: d.updatedAt })).status, 409, "a stale write is refused");
assert.equal((await post("/api/connector/tickets/comment", { db: filed.containerId, row: filed.id, body: "done?" })).status, 200);
const d2 = await get(`/api/connector/tickets/detail?${ref}`);
assert.equal(d2.comments[0].body, "done?");
console.log("ok - tickets: filed, description saved (stale refused), comment added");

// calendar
const cals = await get("/api/calendar/calendars");
assert.ok(cals.calendars.some((c) => c.provider === "connector" && c.name === "Team schedule"));
const evs = await get(`/api/calendar/events?start=${day.getTime()}&end=${day.getTime() + 86400e3}`);
assert.ok(evs.events.some((e) => e.title === "Team standup"));
console.log("ok - calendar: the connector's events show");

// disconnect revokes
await post("/api/connector/disconnect", {});
assert.equal((await mockState()).revoked, 1);
assert.equal((await get("/api/connector/status")).connected, false);
console.log("connector e2e passed");
