// Writes a Sync session for a THROWAWAY test server's data dir and prints the cookie value.
// usage: node scripts/make-test-session.mjs <SYNC_DATA_DIR of the test server> <user id on SYNC_ALLOWED_USERS>
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [dir, userId] = process.argv.slice(2);
if (!dir || !userId) throw new Error("usage: make-test-session.mjs <dataDir> <userId>");
if (path.resolve(dir) === path.resolve(".data")) throw new Error("refusing to write into the real .data directory");
const file = path.join(dir, "sessions.json");
const map = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const id = randomBytes(32).toString("base64url");
const now = Date.now();
map[createHash("sha256").update(`sync-session:v1:${id}`).digest("hex")] = { userId, method: "device", email: null, createdAt: now, expiresAt: now + 3600e3, tailscaleLogin: null };
writeFileSync(file, JSON.stringify(map), { mode: 0o600 });
process.stdout.write(id);
