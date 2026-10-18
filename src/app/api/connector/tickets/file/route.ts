import { ID, safeFile, ticketSource } from "@/lib/server/connector-http";

/** GET ?db=&id= — a ticket's attachment, fetched through the connector. */
export async function GET(request: Request) {
  const src = await ticketSource();
  if (src instanceof Response) return src;
  if (!src.file) return new Response("not found", { status: 404 });
  const u = new URL(request.url);
  const db = u.searchParams.get("db") ?? "";
  const id = u.searchParams.get("id") ?? "";
  if (!ID.test(db) || !ID.test(id)) return new Response("bad id", { status: 400 });
  return safeFile(await src.file(db, id).catch(() => new Response("not found", { status: 502 })));
}
