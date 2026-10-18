import { connection } from "next/server";
import { ticketSource } from "@/lib/server/connector-http";
import { errorMessage, json } from "@/lib/server/http";

/** GET — the connector's ticket projects (with sub-projects) and status / priority / estimate options. */
export async function GET() {
  await connection(); // env / stored connection at request time, never prerendered
  const src = await ticketSource();
  if (src instanceof Response) return src;
  try {
    return json(await src.meta());
  } catch (e) {
    return json({ error: errorMessage(e, "Couldn't load the connector's projects") }, 502);
  }
}
