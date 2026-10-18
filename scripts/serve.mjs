// Starts the Sync server (what `npm start` and the installed background service run).
//
// Settings come from the environment, then $SYNC_HOME/config.env (the installer's), then .env.local:
//   SYNC_HOST  where to listen (default 127.0.0.1 = this computer only; 0.0.0.0 = your network too)
//   SYNC_PORT  default 3000
// It tells the app the address it listens on (SYNC_BIND): only when that's this computer alone does
// a request from this computer get in without signing in (src/lib/server/auth.ts).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const app = path.join(import.meta.dirname, "..");

/** KEY=VALUE lines; # comments; optional quotes. Never overrides what's already set. */
function loadEnv(file, env) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (env[m[1]] === undefined) env[m[1]] = v;
  }
}

const env = { ...process.env };
if (env.SYNC_HOME) {
  loadEnv(path.join(env.SYNC_HOME, "config.env"), env);
  env.SYNC_DATA_DIR ??= path.join(env.SYNC_HOME, "data");
}
loadEnv(path.join(app, ".env.local"), env);
const host = env.SYNC_HOST || "127.0.0.1";
const port = env.SYNC_PORT || "3000";
env.SYNC_BIND = host;
env.NODE_ENV = "production";

if (!existsSync(path.join(app, ".next", "BUILD_ID"))) {
  console.error("Sync isn't built yet. Run `npm run build` first.");
  process.exit(1);
}

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "start", "-H", host, "-p", port], { cwd: app, env, stdio: "inherit" });
// the installer stops the service by this pid (Windows has no service manager for it)
const pidFile = env.SYNC_HOME ? path.join(env.SYNC_HOME, "server.pid") : null;
if (pidFile) writeFileSync(pidFile, String(process.pid));
const stop = (sig) => child.kill(sig);
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", (code, sig) => {
  if (pidFile) rmSync(pidFile, { force: true });
  process.exit(code ?? (sig ? 1 : 0));
});
console.log(`Sync on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
