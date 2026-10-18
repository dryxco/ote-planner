import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { json } from "@/lib/server/http";

// The menu bar app lives next to the calendar helper in the repo's .bin (the live server runs from
// a release copy, so it's found through OTE_CAL_APP's folder when that's set).
const appPath = () =>
  process.env.OTE_MENUBAR_APP ||
  path.join(process.env.OTE_CAL_APP ? path.dirname(process.env.OTE_CAL_APP) : path.join(process.cwd(), ".bin"), "OteMenuBar.app");

/** GET /api/menubar/download -> OteMenuBar.zip (session required, via src/proxy.ts). */
export async function GET() {
  const app = appPath();
  try {
    await fs.access(path.join(app, "Contents", "MacOS", "OteMenuBar"));
  } catch {
    return json({ error: "The Mac app hasn't been built on the server (zsh tools/menubar/build.sh)" }, 404);
  }
  const out = path.join(os.tmpdir(), `OteMenuBar-${process.pid}-${Date.now()}.zip`);
  try {
    // ditto keeps the bundle's code signature and permissions intact (zip -r doesn't)
    await new Promise<void>((ok, bad) => execFile("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, out], { timeout: 30_000 }, (e) => (e ? bad(e) : ok())));
    const data = await fs.readFile(out);
    return new Response(data, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="OteMenuBar.zip"',
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return json({ error: `Couldn't package the Mac app: ${(e as Error).message}` }, 500);
  } finally {
    fs.rm(out, { force: true }).catch(() => {});
  }
}
