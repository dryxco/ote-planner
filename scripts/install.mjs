// Installs (or updates) Sync on this computer as a background app that starts with the computer.
// Run through "Install Sync" (macOS / Linux: Install Sync.command, Windows: Install Sync.cmd), which
// first gets Node.js if needed — or directly: node scripts/install.mjs
//
//   --phone=none|tailscale|wifi   how your phone reaches it (asked when not given)
//   --password=...                password for other devices (asked / generated when needed)
//   --yes                         no questions: keep what's set, defaults otherwise
//   --no-open                     don't open the browser at the end
//   --uninstall [--purge]         remove it (--purge also deletes your data)
//
// Where things go (SYNC_INSTALL_BASE overrides):
//   macOS ~/Library/Application Support/Sync · Windows %LOCALAPPDATA%\Sync · Linux ~/.local/share/sync
//   app/ (the program, replaced on update) · data/ (your data) · config.env (settings) · logs/
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const plat = process.platform; // darwin | win32 | linux
const src = path.join(import.meta.dirname, "..");
const home = os.homedir();
const base =
  process.env.SYNC_INSTALL_BASE ||
  (plat === "darwin" ? path.join(home, "Library", "Application Support", "Sync") : plat === "win32" ? path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Sync") : path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "sync"));
const appDir = path.join(base, "app");
const dataDir = path.join(base, "data");
const logDir = path.join(base, "logs");
const configFile = path.join(base, "config.env");
const LABEL = process.env.SYNC_INSTALL_LABEL || "io.github.sync-planner";
const tty = process.stdin.isTTY && !args.yes;

const say = (s = "") => console.log(s);
const step = (s) => console.log(`\n› ${s}`);
const fail = (s) => {
  console.error(`\n✗ ${s}`);
  process.exit(1);
};

// ---- config.env ----

function readConfig() {
  const c = {};
  if (!existsSync(configFile)) return c;
  for (const line of readFileSync(configFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) c[m[1]] = m[2];
  }
  return c;
}
function writeConfig(c) {
  const lines = [
    "# Sync settings. Run the installer again to change how your phone connects.",
    "# Everything you can set: .env.example in the app folder.",
    ...Object.entries(c).map(([k, v]) => `${k}=${v}`),
  ];
  mkdirSync(base, { recursive: true });
  writeFileSync(configFile, lines.join("\n") + "\n", { mode: 0o600 });
}

// ---- the background service ----

const nodeBin = process.execPath;
const serveJs = path.join(appDir, "scripts", "serve.mjs");
const plist = path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
const unit = path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "systemd", "user", `${LABEL}.service`);
const startupVbs = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${LABEL}.vbs`);
const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { stdio: "ignore", ...opts }).status === 0;
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function stopService() {
  if (plat === "darwin") run("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`]);
  else if (plat === "linux") run("systemctl", ["--user", "stop", LABEL]);
  const pidFile = path.join(base, "server.pid");
  if (existsSync(pidFile)) {
    try {
      process.kill(Number(readFileSync(pidFile, "utf8")));
    } catch {}
    rmSync(pidFile, { force: true });
  }
}

/** Registers the service to start with the computer, and starts it. Returns false if it only runs until the next restart. */
function startService() {
  mkdirSync(logDir, { recursive: true });
  const log = path.join(logDir, "server.log");
  if (plat === "darwin") {
    mkdirSync(path.dirname(plist), { recursive: true });
    writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(LABEL)}</string>
  <key>ProgramArguments</key><array><string>${xml(nodeBin)}</string><string>${xml(serveJs)}</string></array>
  <key>WorkingDirectory</key><string>${xml(appDir)}</string>
  <key>EnvironmentVariables</key><dict><key>SYNC_HOME</key><string>${xml(base)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`,
    );
    return run("launchctl", ["bootstrap", `gui/${process.getuid()}`, plist]) || fail(`Couldn't start the background service (launchctl). See ${log}`);
  }
  if (plat === "linux") {
    mkdirSync(path.dirname(unit), { recursive: true });
    writeFileSync(
      unit,
      `[Unit]
Description=Sync day planner
After=network-online.target

[Service]
Environment=SYNC_HOME=${base}
WorkingDirectory=${appDir}
ExecStart="${nodeBin}" "${serveJs}"
Restart=always
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`,
    );
    if (run("systemctl", ["--user", "daemon-reload"]) && run("systemctl", ["--user", "enable", "--now", LABEL])) return true;
    // no systemd (e.g. some containers): run it now; it won't come back after a restart
    rmSync(unit, { force: true });
    spawnDetached(log);
    return false;
  }
  // Windows: a hidden launcher in the Startup folder, started now as well
  const cmdLine = `cmd /c ""${nodeBin}" "${serveJs}" >> "${log}" 2>&1"`;
  const vbs = (v) => `"${v.replace(/"/g, '""')}"`;
  writeFileSync(
    startupVbs,
    [
      'Set sh = CreateObject("WScript.Shell")',
      `sh.Environment("Process")("SYNC_HOME") = ${vbs(base)}`,
      `sh.CurrentDirectory = ${vbs(appDir)}`,
      `sh.Run ${vbs(cmdLine)}, 0, False`,
    ].join("\r\n") + "\r\n",
  );
  spawn("wscript", [startupVbs], { detached: true, stdio: "ignore" }).unref();
  return true;
}

function spawnDetached(log) {
  const fd = openSync(log, "a");
  spawn(nodeBin, [serveJs], { cwd: appDir, env: { ...process.env, SYNC_HOME: base }, detached: true, stdio: ["ignore", fd, fd] }).unref();
}

// ---- helpers ----

function freePort(start, host) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once("error", () => tryPort(p + 1));
      s.listen(p, host, () => s.close(() => resolve(p)));
    };
    tryPort(start);
  });
}

async function waitUp(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/login`, { redirect: "manual" });
      if (r.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function lanAddress() {
  const all = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal);
  return (all.find((i) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(i.address)) ?? all[0])?.address ?? null;
}

function tailscaleCli() {
  const candidates = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe"];
  return candidates.find((c) => spawnSync(c, ["version"], { stdio: "ignore" }).status === 0) ?? null;
}

/** Shares the server on your tailnet over HTTPS. Picks an HTTPS port nothing else uses there. */
function tailscaleServe(cli, port, keep) {
  const st = spawnSync(cli, ["status", "--json"], { encoding: "utf8" });
  if (st.status !== 0) return { error: "Tailscale isn't running or you're not signed in. Open the Tailscale app, sign in, then run the installer again." };
  const dns = String(JSON.parse(st.stdout || "{}")?.Self?.DNSName ?? "").replace(/\.$/, "");
  if (!dns) return { error: "Tailscale didn't report this computer's name. Is it signed in?" };
  const serve = JSON.parse(spawnSync(cli, ["serve", "status", "--json"], { encoding: "utf8" }).stdout || "{}");
  const used = (p) => {
    const h = serve?.Web?.[`${dns}:${p}`]?.Handlers?.["/"]?.Proxy;
    return h && h !== `http://127.0.0.1:${port}`;
  };
  let https = Number(keep) || 443;
  while (used(https)) https = https === 443 ? 8444 : https + 1;
  if (!run(cli, ["serve", "--bg", `--https=${https}`, `http://127.0.0.1:${port}`])) {
    return { error: "`tailscale serve` failed. In the Tailscale admin console, turn on HTTPS certificates (DNS → HTTPS), then run the installer again." };
  }
  return { url: `https://${dns}${https === 443 ? "" : `:${https}`}`, https };
}

function openBrowser(url) {
  if (args["no-open"]) return;
  if (plat === "darwin") run("open", [url]);
  else if (plat === "win32") run("cmd", ["/c", "start", "", url]);
  else run("xdg-open", [url]);
}

/** Runs npm; its output goes to logs/install.log and is shown only when it fails. */
function npm(a, cwd) {
  const cli = [path.join(path.dirname(nodeBin), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), path.join(path.dirname(nodeBin), "node_modules", "npm", "bin", "npm-cli.js")].find(existsSync);
  const opts = { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  const r = cli ? spawnSync(nodeBin, [cli, ...a], opts) : spawnSync("npm", a, { ...opts, shell: plat === "win32" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, "install.log"), `$ npm ${a.join(" ")}\n${out}\n`, { flag: "a" });
  if (r.status !== 0) console.error(out.split("\n").slice(-40).join("\n"));
  return r.status === 0;
}

async function ask(q, def) {
  if (!tty) return def;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a || def;
}

// ---- uninstall ----

if (args.uninstall) {
  step("Stopping Sync");
  stopService();
  rmSync(plist, { force: true });
  rmSync(unit, { force: true });
  if (plat === "linux") run("systemctl", ["--user", "daemon-reload"]);
  if (plat === "win32") rmSync(startupVbs, { force: true });
  const c = readConfig();
  if (c.SYNC_TAILSCALE_HTTPS) {
    const cli = tailscaleCli();
    if (cli) run(cli, ["serve", `--https=${c.SYNC_TAILSCALE_HTTPS}`, "off"]);
  }
  rmSync(appDir, { recursive: true, force: true });
  rmSync(path.join(base, "runtime"), { recursive: true, force: true });
  if (args.purge) {
    rmSync(base, { recursive: true, force: true });
    say("\n✓ Sync and all its data are removed.");
  } else {
    say(`\n✓ Sync is removed. Your data is still in ${dataDir}`);
    say("  (install again to get it back, or delete that folder to remove it for good)");
  }
  process.exit(0);
}

// ---- install / update ----

const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 20 || (maj === 20 && min < 9)) fail(`Sync needs Node.js 20.9 or newer (this is ${process.versions.node}).`);

const config = readConfig();
const updating = existsSync(path.join(appDir, ".next", "BUILD_ID"));
say(updating ? "Updating Sync…" : "Installing Sync…");
say(`  into ${base}`);

// how the phone connects
const modes = { 1: "none", 2: "tailscale", 3: "wifi" };
let phone = typeof args.phone === "string" ? args.phone : config.SYNC_PHONE;
if (!phone || (tty && typeof args.phone !== "string")) {
  const cur = Object.entries(modes).find(([, v]) => v === (phone ?? "none"))?.[0] ?? "1";
  say(`
Do you want to use Sync on your phone or another computer too?
  1) Not now — only on this computer (no password needed)
  2) Yes, with Tailscale — private, works anywhere (free app on both devices)
  3) Yes, on the same Wi-Fi — simplest, needs a password, only at home`);
  phone = modes[await ask(`Choose 1, 2 or 3 [${cur}]: `, cur)] ?? "none";
}
if (!["none", "tailscale", "wifi"].includes(phone)) fail(`--phone must be none, tailscale or wifi`);

const ts = phone === "tailscale" ? tailscaleCli() : null;
if (phone === "tailscale" && !ts) {
  say("\n  Tailscale isn't installed. Get it at https://tailscale.com/download (on this computer and your phone),");
  say("  sign in with the same account on both, then run the installer again. Continuing for this computer only.");
  phone = "none";
}

// a password for other devices
let shownPassword = null;
if (phone !== "none" && !config.SYNC_PASSWORD) {
  let pw = typeof args.password === "string" ? args.password : await ask("\nChoose a password for your other devices (Enter = make one up for me): ", "");
  if (!pw) pw = shownPassword = randomBytes(9).toString("base64url");
  config.SYNC_PASSWORD = pw;
} else if (typeof args.password === "string") config.SYNC_PASSWORD = args.password;

step("Stopping the running Sync (if any)");
stopService();

step("Copying the app");
if (path.resolve(src) !== path.resolve(appDir)) {
  rmSync(appDir, { recursive: true, force: true });
  const skip = new Set(["node_modules", ".next", ".data", ".git", ".bin", ".env.local", "runtime"]);
  cpSync(src, appDir, { recursive: true, filter: (f) => !skip.has(path.basename(f)) || path.dirname(f) !== path.resolve(src) });
}

step("Installing what it needs (a few minutes the first time)");
if (!npm(["ci", "--no-audit", "--no-fund", "--loglevel=error"], appDir)) fail("Installing the dependencies failed (see above). Check your internet connection and run the installer again.");

step("Building");
if (!npm(["run", "build"], appDir)) fail(`The build failed (see above, and ${path.join(logDir, "install.log")}).`);

config.SYNC_SECRET ||= randomBytes(32).toString("base64");
config.SYNC_PHONE = phone;
config.SYNC_HOST = phone === "wifi" ? "0.0.0.0" : "127.0.0.1";
config.SYNC_PORT ||= String(await freePort(3000, config.SYNC_HOST));
config.APP_URL ||= `http://localhost:${config.SYNC_PORT}`;
writeConfig(config);

step("Starting Sync in the background");
const persistent = startService();
if (!(await waitUp(config.SYNC_PORT))) fail(`Sync didn't come up. See ${path.join(logDir, "server.log")}`);

let phoneUrl = null;
let phoneNote = null;
if (phone === "tailscale") {
  const r = tailscaleServe(ts, config.SYNC_PORT, config.SYNC_TAILSCALE_HTTPS);
  if (r.error) phoneNote = r.error;
  else {
    phoneUrl = r.url;
    config.SYNC_TAILSCALE_HTTPS = String(r.https);
    writeConfig(config);
  }
} else if (phone === "wifi") {
  const ip = lanAddress();
  phoneUrl = ip ? `http://${ip}:${config.SYNC_PORT}` : null;
  phoneNote = ip ? null : "Couldn't find this computer's Wi-Fi address.";
}

const local = `http://localhost:${config.SYNC_PORT}`;
say(`
✓ Sync is ${updating ? "updated" : "installed"} and running.

  On this computer:  ${local}${phone === "wifi" ? "  (sign in with the password)" : ""}`);
if (phoneUrl) say(`  On your phone:     ${phoneUrl}\n                     then Share → Add to Home Screen to use it like an app`);
if (phone === "tailscale" && phoneUrl) say("                     (the phone needs the Tailscale app, signed in to the same account)");
if (phone === "wifi") say("                     (only while the phone is on the same Wi-Fi; if your computer asks to allow\n                      incoming connections for \"node\", choose Allow)");
if (phoneNote) say(`\n  ! ${phoneNote}`);
if (shownPassword) say(`\n  Password for other devices: ${shownPassword}\n  (saved in ${configFile} as SYNC_PASSWORD)`);
else if (phone !== "none") say(`\n  Other devices sign in with your password (SYNC_PASSWORD in ${configFile}).`);
say(persistent ? "\n  It starts by itself when you turn on the computer." : "\n  ! It runs until the computer restarts (no service manager here): run the installer again after a restart.");
say(`  Your data: ${dataDir}\n  To update: download the new version and run the installer again. To remove: run "Uninstall Sync".`);
openBrowser(local);
