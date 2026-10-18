import { ID, ticketSource } from "@/lib/server/connector-http";
import { StaleError } from "@/lib/server/connectors/types";
import { checkSameOriginUpload, errorMessage, json } from "@/lib/server/http";

const MAX_BYTES = 32 * 1024 * 1024;

/**
 * POST multipart {db, row, base, position, files[]} — add images to a ticket's description (at the
 * start or the end; `base` refuses it if the ticket changed there meanwhile). Returns the new body.
 */
export async function POST(request: Request) {
  const guard = checkSameOriginUpload(request);
  if (guard) return guard;
  const src = await ticketSource();
  if (src instanceof Response) return src;
  if (!src.addBodyImages) return json({ error: "This connector can't take images" }, 404);
  const form = await request.formData().catch(() => null);
  const db = String(form?.get("db") ?? "");
  const row = String(form?.get("row") ?? "");
  const base = String(form?.get("base") ?? "");
  const position = form?.get("position") === "start" ? "start" : "end";
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File);
  if (!ID.test(db) || !ID.test(row) || !base || !files.length || files.length > 20) return json({ error: "bad request" }, 400);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return json({ error: "Images are too large (32 MB at most)" }, 413);
  if (files.some((f) => !/^image\//.test(f.type))) return json({ error: "Only image files can go in" }, 415);
  try {
    return json(await src.addBodyImages({ containerId: db, id: row }, files, base, position));
  } catch (e) {
    if (e instanceof StaleError) return json({ error: "It changed there meanwhile — close and open it again.", stale: true }, 409);
    return json({ error: errorMessage(e, "Upload failed") }, 502);
  }
}
