// Plan alerts API: VAPID public key, subscribe / unsubscribe this device (no real push is sent).
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:3123";
const cookie = `sync_session=${process.env.SYNC_TEST_SESSION}`;
const api = async (body) => {
  const r = await fetch(base + "/api/push", { method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json", origin: base }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
};
let r = await api();
assert.match(r.json.publicKey, /^[A-Za-z0-9_-]{80,}$/, "VAPID public key");
assert.deepEqual(r.json.devices, []);
const sub = { endpoint: "https://web.push.apple.com/test-endpoint", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };
assert.equal((await api({ action: "subscribe", subscription: { endpoint: "http://insecure" } })).status, 400);
assert.equal((await api({ action: "subscribe", subscription: sub, label: "iPhone" })).json.ok, true);
r = await api();
assert.deepEqual(r.json.devices.map((d) => d.label), ["iPhone"]);
await api({ action: "subscribe", subscription: sub, label: "iPhone" });
assert.equal((await api()).json.devices.length, 1, "re-subscribing the same device doesn't duplicate it");
assert.equal((await api({ action: "unsubscribe", endpoint: sub.endpoint })).json.ok, true);
assert.equal((await api()).json.devices.length, 0);
console.log("push e2e passed");
