import { ID, ticketSource } from "@/lib/server/connector-http";
import { errorMessage, json } from "@/lib/server/http";

/** GET ?db=&row= — what the ticket sheet loads on open: the description, status history, comments. */
export async function GET(request: Request) {
  const src = await ticketSource();
  if (src instanceof Response) return src;
  const u = new URL(request.url);
  const db = u.searchParams.get("db") ?? "";
  const row = u.searchParams.get("row") ?? "";
  if (!ID.test(db) || !ID.test(row)) return json({ error: "bad id" }, 400);
  if (!src.detail) return json({ body: null, updatedAt: "", history: [], comments: [] });
  try {
    return json(await src.detail({ containerId: db, id: row }));
  } catch (e) {
    return json({ error: errorMessage(e, "Couldn't load the ticket") }, 502);
  }
}
