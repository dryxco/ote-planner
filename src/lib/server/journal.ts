// Append-only log of every change to to-dos / plans / actuals / tickets: each record before → after,
// and who made it (a device: its window id + user agent; or "server": the connector / calendar syncs). On 10/10 checked to-dos went unchecked and nothing told which device
// had written them, or what they were before; this keeps both (to trace it, and to put it back).
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Applied } from "./syncdb";

const COLS = new Set(["todos", "plans", "actuals", "tickets", "campaigns"]);
const MAX_BYTES = 5_000_000; // then it moves to sync-journal.1.jsonl (one older file kept)

const file = () => path.join(process.env.OTE_DATA_DIR || path.join(process.cwd(), ".data"), "sync-journal.jsonl");

export async function journal(applied: Applied, device: { client: string | null; ua: string | null }) {
  const lines = applied
    .filter((a) => COLS.has(a.change.col))
    .map((a) =>
      JSON.stringify({
        at: Date.now(),
        col: a.change.col,
        id: a.change.id,
        updatedAt: a.change.updatedAt,
        fields: a.change.fields ?? null,
        client: device.client,
        ua: device.ua,
        before: a.before ? (a.before.deleted ? { deleted: true } : a.before.data) : null,
        after: a.after.deleted ? { deleted: true } : a.after.data,
      }),
    );
  if (!lines.length) return;
  try {
    const f = file();
    const size = await fs.stat(f).then((s) => s.size).catch(() => 0);
    if (size > MAX_BYTES) await fs.rename(f, f.replace(/\.jsonl$/, ".1.jsonl"));
    await fs.appendFile(f, lines.join("\n") + "\n", { mode: 0o600 });
  } catch (e) {
    console.warn(`[sync] journal write failed: ${(e as Error).message}`);
  }
}
