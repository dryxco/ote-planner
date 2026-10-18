// Bearer token for the Mac menu bar app (tools/menubar), which can't sign in itself.
// It only unlocks GET /api/now (current/next plan); src/proxy.ts lets nothing else through
// with it. Created on first use; delete the file to rotate it (every Mac then needs the new one).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const tokenFile = () => path.join(process.env.SYNC_DATA_DIR || path.join(process.cwd(), ".data"), "menubar-token");

let pending: Promise<string> | null = null;

/** The token, created (0600) if missing. Not cached across calls so a deleted file rotates it. */
export function menubarToken(): Promise<string> {
  // one in-flight read/create at a time so concurrent first requests agree on the value
  pending ??= readOrCreate().finally(() => {
    pending = null;
  });
  return pending;
}

async function readOrCreate(): Promise<string> {
  try {
    const t = (await fs.readFile(tokenFile(), "utf8")).trim();
    if (t) return t;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const t = randomBytes(32).toString("base64url");
  await fs.mkdir(path.dirname(tokenFile()), { recursive: true, mode: 0o700 });
  // wx: if another process created it meanwhile, keep theirs
  try {
    await fs.writeFile(tokenFile(), t + "\n", { mode: 0o600, flag: "wx" });
    return t;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    return (await fs.readFile(tokenFile(), "utf8")).trim();
  }
}

/** Constant-time check of an `Authorization: Bearer …` header. */
export async function isMenubarRequest(request: Request): Promise<boolean> {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!m) return false;
  const given = Buffer.from(m[1]);
  const want = Buffer.from(await menubarToken());
  return given.length === want.length && timingSafeEqual(given, want);
}
