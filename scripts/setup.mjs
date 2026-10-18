// First-time setup: writes .env.local with a password and an encryption key.
// usage: npm run setup            (asks for a password; Enter = generate one)
//        npm run setup -- --yes   (no questions: generates the password and prints it)
// An existing .env.local is kept: only settings it lacks are added.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const root = path.join(import.meta.dirname, "..");
const file = path.join(root, ".env.local");
const yes = process.argv.includes("--yes");

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) {
  console.error(`Sync needs Node.js 20.9 or newer (this is ${process.versions.node}). Get it from https://nodejs.org`);
  process.exit(1);
}
if (!existsSync(path.join(root, "node_modules", "next"))) {
  console.error("Run `npm install` first, then `npm run setup` again.");
  process.exit(1);
}

const current = existsSync(file) ? readFileSync(file, "utf8") : "";
const has = (key) => new RegExp(`^${key}=.+`, "m").test(current);
const add = [];

let generated = null;
if (!has("SYNC_PASSWORD")) {
  let pw = "";
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    pw = (await rl.question("Choose a password for signing in to Sync (Enter = generate one): ")).trim();
    rl.close();
  }
  if (!pw) pw = generated = randomBytes(12).toString("base64url");
  add.push(`# Password for the sign-in page\nSYNC_PASSWORD=${pw}`);
}
if (!has("SYNC_SECRET")) {
  add.push(`# Encrypts saved calendar / connector logins. Keep it: changing it makes them unreadable.\nSYNC_SECRET=${randomBytes(32).toString("base64")}`);
}
if (!/^APP_URL=/m.test(current)) add.push("# Address you open Sync at (used for Google sign-in)\nAPP_URL=http://localhost:3000");

if (add.length) {
  const head = current ? `${current.replace(/\n*$/, "\n")}\n` : "# Sync settings — see .env.example for everything you can set.\n\n";
  writeFileSync(file, head + add.join("\n\n") + "\n", { mode: 0o600 });
  console.log(`\n✓ Wrote ${path.relative(process.cwd(), file) || ".env.local"}`);
} else {
  console.log("\n✓ .env.local already has a password and a key — nothing to change.");
}
if (generated) console.log(`\n  Your password: ${generated}\n  (it's in .env.local as SYNC_PASSWORD — change it there any time)`);
console.log(`
Next:
  npm run build     (once, and after each update)
  npm start         then open http://localhost:3000
`);
