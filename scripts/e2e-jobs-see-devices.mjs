// The background jobs see what devices save (production build only: there the jobs and the API
// routes were separate bundles with separate copies of the sync data). Once, the jobs' stale copy
// made the task sync archive to-dos made since on the board, and then delete them in Sync.
// Server: NODE_ENV=production next start (jobs on) with SYNC_DATA_DIR=<tmp>, SYNC_ALLOWED_USERS=good-user
// and scripts/mock-connector.mjs running.
// usage: node scripts/e2e-jobs-see-devices.mjs <base> <mock>
import assert from "node:assert/strict";

const [base, mock] = process.argv.slice(2);
const cookie = `sync_session=${process.env.SYNC_TEST_SESSION}`;
const api = async (path, body) => {
  const r = await fetch(base + path, { method: "POST", headers: { cookie, "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const board = async () => (await (await fetch(mock + "/_state")).json()).tasks;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const started = Date.now();
assert.equal((await api("/api/connector/connect", { connector: "rest", config: { url: mock, token: "test-token" } })).ok, true);
// the jobs' timer runs every 60 s from the server start: let one run read the sync data first
console.log("waiting for the jobs' first timer run…");
await sleep(Math.max(0, 68_000 - (Date.now() - started)));
const id = crypto.randomUUID();
const now = Date.now();
await api("/api/sync", { since: 0, changes: [{ col: "todos", id, updatedAt: now, data: { id, name: "made on a device", activityId: "work", color: "#000", done: false, createdAt: now } }] });
await sleep(5000); // the push's own run files it on the board
assert.ok((await board()).find((t) => t.id === id), "filed on the board");
console.log("waiting for the jobs' timer run (~60 s)…");
await sleep(70_000);
assert.ok((await board()).find((t) => t.id === id), "still on the board");
console.log("ok - the jobs see what a device saved");
