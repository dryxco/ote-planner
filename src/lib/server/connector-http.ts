// Shared bits of the /api/connector/tickets routes.
import { activeConnector } from "./connectors";
import type { TicketSource } from "./connectors/types";
import { json } from "./http";

export const ID = /^[A-Za-z0-9_.:-]{1,120}$/;

/** The ticket source, or a 404 response when no connector (or none with tickets) is set up. */
export async function ticketSource(): Promise<TicketSource | Response> {
  const a = await activeConnector();
  return a?.c.tickets ?? json({ error: "No connector with tickets is connected" }, 404);
}

/** A file streamed from the connector, made safe to serve from Ote's origin. */
export function safeFile(r: Response, cache = "private, max-age=3600"): Response {
  if (!r.ok || !r.body) return r;
  const headers = new Headers({ "cache-control": cache, "x-content-type-options": "nosniff" });
  for (const h of ["content-type", "content-length", "content-disposition"]) {
    const v = r.headers.get(h);
    if (v) headers.set(h, v);
  }
  // anything but media downloads instead of rendering (no uploaded HTML/SVG runs here)
  const type = headers.get("content-type") ?? "";
  if (!/^(image\/(png|jpe?g|gif|webp|avif|heic)|video\/|audio\/)/i.test(type)) {
    headers.set("content-type", "application/octet-stream");
    if (!headers.get("content-disposition")?.startsWith("attachment")) headers.set("content-disposition", "attachment");
  }
  headers.set("content-security-policy", "sandbox; default-src 'none'");
  return new Response(r.body, { status: 200, headers });
}
