import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("store encrypts at rest, round-trips, and explains a wrong OTE_SECRET", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sync-store-"));
  const cwd = process.cwd();
  process.chdir(dir);
  process.env.OTE_SECRET = "test-secret-one";
  try {
    const { getStore, updateStore } = await import("./store");
    await updateStore((s) => {
      s.apple.push({ accountId: "a", appleId: "me@example.com", appPassword: "abcd-efgh-ijkl-mnop", connectedAt: 1 });
    });
    const raw = readFileSync(path.join(dir, ".data", "integrations.json"), "utf8");
    assert.ok(!raw.includes("abcd-efgh") && !raw.includes("icloud.com"), "plaintext leaked to disk");
    assert.equal((await getStore()).apple[0].appPassword, "abcd-efgh-ijkl-mnop");

    // Same file, different key (fresh module instance) -> clear, actionable error.
    process.env.OTE_SECRET = "test-secret-two";
    const freshSpec = "./store?wrong-key"; // query string forces a new module instance
    const fresh: typeof import("./store") = await import(freshSpec);
    await assert.rejects(fresh.getStore(), /OTE_SECRET/);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("integrations store honors OTE_DATA_DIR (test servers never touch the real .data)", async () => {
  const { mkdtempSync, existsSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "store-iso-"));
  const prev = process.env.OTE_DATA_DIR;
  process.env.OTE_DATA_DIR = dir;
  try {
    const { updateStore } = await import("./store");
    await updateStore((s) => {
      s.mac = true;
    });
    assert.ok(existsSync(path.join(dir, "integrations.json")));
  } finally {
    if (prev === undefined) delete process.env.OTE_DATA_DIR;
    else process.env.OTE_DATA_DIR = prev;
  }
});
