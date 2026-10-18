import { ID, ticketSource } from "@/lib/server/connector-http";
import { StaleError } from "@/lib/server/connectors/types";
import { checkSameOrigin, errorMessage, json } from "@/lib/server/http";

const STALE = "It changed there meanwhile — close and open it again.";

/**
 * POST {db, row, body, base} — save a ticket's description (BlockNote JSON). `base` (the updatedAt
 * read with it) makes the connector refuse the write if the ticket changed there in the meantime.
 */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const src = await ticketSource();
  if (src instanceof Response) return src;
  if (!src.saveBody) return json({ error: "This connector can't save descriptions" }, 404);
  const b = (await request.json().catch(() => null)) as { db?: string; row?: string; body?: string; base?: string } | null;
  if (!b || !ID.test(b.db ?? "") || !ID.test(b.row ?? "") || typeof b.body !== "string" || b.body.length > 500_000 || typeof b.base !== "string") {
    return json({ error: "bad request" }, 400);
  }
  try {
    if (!Array.isArray(JSON.parse(b.body))) throw new Error();
  } catch {
    return json({ error: "body must be a BlockNote document" }, 400);
  }
  try {
    const r = await src.saveBody({ containerId: b.db!, id: b.row! }, b.body, b.base);
    return json({ ok: true, updatedAt: r.updatedAt });
  } catch (e) {
    if (e instanceof StaleError) return json({ error: STALE, stale: true }, 409);
    return json({ error: errorMessage(e, "Couldn't save the description") }, 502);
  }
}
