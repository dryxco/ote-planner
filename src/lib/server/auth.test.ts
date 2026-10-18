import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SESSION_TTL_MS, checkPassword, createSession, deleteSession, getSession, isAllowedUser, tailscaleGate } from "./auth";

before(() => {
  process.env.SYNC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "auth-"));
  process.env.SYNC_ALLOWED_USERS = "user-1234, owner@example.com";
  process.env.SYNC_ALLOWED_TAILSCALE_USERS = "phone@example.com";
  process.env.SYNC_PASSWORD = "correct horse";
});

const h = (o: Record<string, string>) => new Headers(o);

test("tailscale gate: allowed login passes, others and anonymous proxied requests are denied", () => {
  assert.equal(tailscaleGate(h({ "tailscale-user-login": "phone@example.com", "x-forwarded-for": "100.1.1.1" })), null);
  assert.match(tailscaleGate(h({ "tailscale-user-login": "stranger@example.org", "x-forwarded-for": "100.1.1.1" }))!, /stranger/);
  assert.ok(tailscaleGate(h({ "x-forwarded-for": "100.1.1.1" })), "tagged/unknown device through serve");
  assert.equal(tailscaleGate(h({})), null, "direct local request (still needs a session)");
  assert.equal(tailscaleGate(h({ "x-forwarded-for": "::1" })), null, "Next's own loopback X-Forwarded-For");
  assert.equal(tailscaleGate(h({ "x-forwarded-for": "127.0.0.1" })), null);
});

test("allowlist matches user id or email, case-insensitively; empty allowlist allows nobody", () => {
  assert.ok(isAllowedUser("USER-1234", null));
  assert.ok(isAllowedUser("other", "Owner@Example.com"));
  assert.ok(!isAllowedUser("other", "someone@example.com"));
  const saved = process.env.SYNC_ALLOWED_USERS;
  process.env.SYNC_ALLOWED_USERS = "";
  assert.ok(!isAllowedUser("user-1234", "owner@example.com"));
  process.env.SYNC_ALLOWED_USERS = saved;
});

test("password: only SYNC_PASSWORD matches; unset = no password sign-in", () => {
  assert.ok(checkPassword("correct horse"));
  assert.ok(!checkPassword("correct horse "));
  assert.ok(!checkPassword(""));
  const saved = process.env.SYNC_PASSWORD;
  delete process.env.SYNC_PASSWORD;
  assert.ok(!checkPassword(""));
  process.env.SYNC_PASSWORD = saved;
});

test("sessions: create, read, revoke; removed from allowlist -> invalid at once", async () => {
  const { id } = await createSession({ userId: "user-1234", method: "device", email: null, tailscaleLogin: null });
  assert.ok(getSession(id));
  assert.equal(getSession(id + "x"), null);
  const saved = process.env.SYNC_ALLOWED_USERS;
  process.env.SYNC_ALLOWED_USERS = "owner@example.com";
  assert.equal(getSession(id), null);
  process.env.SYNC_ALLOWED_USERS = saved;
  await deleteSession(id);
  assert.equal(getSession(id), null);
});

test("a password session ends when the password sign-in is turned off", async () => {
  const { id } = await createSession({ userId: "password", method: "password", email: null, tailscaleLogin: null });
  assert.ok(getSession(id));
  const saved = process.env.SYNC_PASSWORD;
  delete process.env.SYNC_PASSWORD;
  assert.equal(getSession(id), null);
  process.env.SYNC_PASSWORD = saved;
  assert.ok(getSession(id));
});

test("this computer needs no sign-in only when the server listens on it alone", async () => {
  const { isLocalRequest } = await import("./auth");
  const saved = process.env.SYNC_BIND;
  process.env.SYNC_BIND = "127.0.0.1";
  assert.ok(isLocalRequest(h({})), "a direct request");
  assert.ok(isLocalRequest(h({ "x-forwarded-for": "127.0.0.1" })), "Next's own loopback X-Forwarded-For");
  assert.ok(!isLocalRequest(h({ "tailscale-user-login": "phone@example.com", "x-forwarded-for": "100.1.1.1" })), "relayed by tailscale serve");
  assert.ok(!isLocalRequest(h({ "x-forwarded-for": "127.0.0.1, 100.64.0.9" })), "a forged loopback before the real hop");
  process.env.SYNC_BIND = "0.0.0.0";
  assert.ok(!isLocalRequest(h({})), "listening on the network: anyone could send these headers");
  delete process.env.SYNC_BIND;
  assert.ok(!isLocalRequest(h({})), "unknown bind address: no exemption");
  process.env.SYNC_BIND = saved;
  if (saved === undefined) delete process.env.SYNC_BIND;
});

test("tailscale gate is off when no Tailscale allowlist is configured (the sign-in decides)", () => {
  const saved = process.env.SYNC_ALLOWED_TAILSCALE_USERS;
  process.env.SYNC_ALLOWED_TAILSCALE_USERS = "";
  assert.equal(tailscaleGate(h({ "tailscale-user-login": "stranger@example.org", "x-forwarded-for": "100.1.1.1" })), null);
  assert.equal(tailscaleGate(h({ "x-forwarded-for": "100.1.1.1" })), null);
  process.env.SYNC_ALLOWED_TAILSCALE_USERS = saved;
});

test("sessions last about six months", async () => {
  const { session } = await createSession({ userId: "user-1234", method: "device", email: null, tailscaleLogin: null });
  const days = (session.expiresAt - session.createdAt) / 86_400_000;
  assert.equal(days, 180);
  assert.equal(SESSION_TTL_MS, 180 * 86_400_000);
});
