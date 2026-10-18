import { readFileSync } from "node:fs";
import path from "node:path";
import { json } from "@/lib/server/http";

let buildId: string | null = null;

/** GET /api/version -> {buildId}: lets open clients (home-screen apps) reload after a deploy. */
export function GET() {
  if (!buildId) {
    try {
      buildId = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    } catch {
      buildId = "dev";
    }
  }
  return json({ buildId });
}
