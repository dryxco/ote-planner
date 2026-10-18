import { checkSameOrigin, json, readJson } from "@/lib/server/http";
import { dataOwner } from "@/lib/server/identity";
import { syncUser, type Applied } from "@/lib/server/syncdb";
import { journal } from "@/lib/server/journal";
import { nudgeTicketPull, scheduleTaskSync, scheduleTicketSync } from "@/lib/server/connector-jobs";
import { scheduleCalendarWrites } from "@/lib/server/calendar-writer";
import { isSyncChange, type SyncRequest, type SyncResponse } from "@/lib/sync-protocol";

const MAX_CHANGES = 5000;

/**
 * POST /api/sync {since, changes} -> {version, changes}
 * Pushes this device's changes (merged per record, last write wins) and returns everything
 * that changed on the server after `since`.
 */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const body = await readJson<SyncRequest>(request);
  if (!body || typeof body.since !== "number" || !Array.isArray(body.changes)) {
    return json({ error: "since (number) and changes (array) are required" }, 400);
  }
  if (body.changes.length > MAX_CHANGES) return json({ error: `At most ${MAX_CHANGES} changes per request` }, 413);
  const bad = body.changes.findIndex((c) => !isSyncChange(c));
  if (bad !== -1) return json({ error: `Invalid change (index ${bad})` }, 400);
  try {
    const applied: Applied = [];
    const res: SyncResponse = await syncUser(dataOwner(request), body.since, body.changes, applied);
    void journal(applied, { client: request.headers.get("x-sync-client")?.slice(0, 64) ?? null, ua: request.headers.get("user-agent")?.slice(0, 300) ?? null });
    if (body.changes.some((c) => c.col === "todos" || c.col === "plans")) scheduleTaskSync();
    if (body.changes.some((c) => c.col === "tickets")) scheduleTicketSync();
    else if (!process.env.OTE_DISABLE_JOBS) nudgeTicketPull();
    if (body.changes.some((c) => c.col === "plans") && !process.env.OTE_DISABLE_JOBS) scheduleCalendarWrites();
    return json(res);
  } catch (e) {
    return json({ error: `Couldn't save sync changes: ${(e as Error).message}` }, 500);
  }
}
