import { ID, ticketSource } from "@/lib/server/connector-http";
import { checkSameOrigin, errorMessage, json } from "@/lib/server/http";

/** POST {db, row, body} — add a comment to a ticket (written as the connected account). */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const src = await ticketSource();
  if (src instanceof Response) return src;
  if (!src.addComment) return json({ error: "This connector can't take comments" }, 404);
  const b = (await request.json().catch(() => null)) as { db?: string; row?: string; body?: string } | null;
  const text = (b?.body ?? "").trim();
  if (!b || !ID.test(b.db ?? "") || !ID.test(b.row ?? "") || !text || text.length > 4000) return json({ error: "bad request" }, 400);
  try {
    return json(await src.addComment({ containerId: b.db!, id: b.row! }, text));
  } catch (e) {
    return json({ error: errorMessage(e, "Couldn't add the comment") }, 502);
  }
}
