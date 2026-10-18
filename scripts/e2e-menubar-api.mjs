// Menu bar API e2e against a throwaway server started with:
//   SYNC_DATA_DIR=<tmp> SYNC_DISABLE_JOBS=1 SYNC_ALLOWED_USERS=good-user next start -p 3302
// usage: node scripts/e2e-menubar-api.mjs <baseUrl> <that server's SYNC_DATA_DIR>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const [base, dataDir] = process.argv.slice(2);
if (!base || !dataDir) throw new Error("usage: e2e-menubar-api.mjs <baseUrl> <dataDir of the throwaway server>");
const session = execFileSync("node", [path.join(import.meta.dirname, "make-test-session.mjs"), dataDir, "good-user"], { encoding: "utf8" });
const cookie = { cookie: `sync_session=${session}` };
const bearer = (t) => ({ authorization: `Bearer ${t}` });

// no credentials / wrong token: 401; the token alone doesn't open any other route
let r = await fetch(base + "/api/now");
assert.equal(r.status, 401);
r = await fetch(base + "/api/now", { headers: bearer("not-the-token") });
assert.equal(r.status, 401);
r = await fetch(base + "/api/menubar/token", { headers: bearer("not-the-token") });
assert.equal(r.status, 401, "token endpoint needs a session");
console.log("ok - without a valid token: 401");

// the signed-in user copies the token; it's stored 0600 in the data dir and stable
r = await fetch(base + "/api/menubar/token", { headers: cookie });
assert.equal(r.status, 200);
const { token } = await r.json();
assert.ok(token.length >= 43, "32+ random bytes");
assert.equal(readFileSync(path.join(dataDir, "menubar-token"), "utf8").trim(), token);
assert.equal(statSync(path.join(dataDir, "menubar-token")).mode & 0o777, 0o600);
assert.equal((await (await fetch(base + "/api/menubar/token", { headers: cookie })).json()).token, token);
r = await fetch(base + "/api/sync", { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: '{"since":0,"changes":[]}' });
assert.equal(r.status, 401, "the menu bar token only unlocks /api/now");
console.log("ok - token from Settings endpoint, 0600 file, only /api/now accepts it");

r = await fetch(base + "/api/now", { headers: bearer(token) });
assert.equal(r.status, 200);
let body = await r.json();
assert.equal(body.current, null);
console.log("ok - with token: 200, no plan yet");

// push a plan running now (+ an unnamed one later today) through the normal sync API
const now = Date.now();
const min = 60_000;
const plan = (id, name, start, end) => ({
  col: "plans", id, updatedAt: now,
  data: { id, name, activityId: "act-e2e", color: "#30d158", allDay: false, start, end, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: now },
});
const endOfDay = new Date(now).setHours(24, 0, 0, 0);
const laterStart = Math.min(now + 60 * min, endOfDay - 2 * min);
const changes = [
  plan("p-now", "Menu bar e2e", now - 10 * min, now + 23 * min),
  { col: "activities", id: "act-e2e", updatedAt: now, data: { id: "act-e2e", name: "E2E activity", color: "#ff9f0a", order: 0, reminder: "none", endConfirmation: false } },
];
// a "next" only exists when there's still room left today
if (laterStart > now + 23 * min) changes.push(plan("p-later", "", laterStart, laterStart + min));
r = await fetch(base + "/api/sync", { method: "POST", headers: { ...cookie, "content-type": "application/json" }, body: JSON.stringify({ since: 0, changes }) });
assert.equal(r.status, 200);

body = await (await fetch(base + "/api/now", { headers: bearer(token) })).json();
assert.deepEqual(body.current, { name: "Menu bar e2e", color: "#30d158", start: now - 10 * min, end: now + 23 * min });
if (changes.length === 3) assert.equal(body.next?.name, "E2E activity", "unnamed plan shows its activity's name");
assert.ok(Math.abs(body.now - Date.now()) < 60_000);
console.log("ok - current plan after a sync push" + (changes.length === 3 ? "; next plan named after its activity" : ""));

// deleting the plan clears it
r = await fetch(base + "/api/sync", {
  method: "POST",
  headers: { ...cookie, "content-type": "application/json" },
  body: JSON.stringify({ since: 0, changes: [{ col: "plans", id: "p-now", updatedAt: now + 1, deleted: true }] }),
});
assert.equal(r.status, 200);
body = await (await fetch(base + "/api/now", { headers: bearer(token) })).json();
assert.equal(body.current, null);
console.log("ok - deleted plan is gone");

console.log("menubar api e2e passed");
