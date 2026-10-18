import type { NextRequest } from "next/server";
import { getEvents } from "@/lib/server/calendar";
import { json } from "@/lib/server/http";
import { isValidTimeZone } from "@/lib/server/time";
import type { EventsResponse } from "@/lib/types";

const MAX_SPAN_MS = 400 * 86_400_000;

/**
 * GET /api/calendar/events?start=<ms>&end=<ms>[&tz=<IANA zone>]
 * `tz` (optional, e.g. "Asia/Seoul") sets the zone for all-day and floating times;
 * defaults to the server's local zone.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const start = Number(q.get("start"));
  const end = Number(q.get("end"));
  if (!q.get("start") || !q.get("end") || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return json({ events: [], error: "start and end query params are required (epoch ms, end > start)" }, 400);
  }
  if (end - start > MAX_SPAN_MS) {
    return json({ events: [], error: "Range can be at most 400 days" }, 400);
  }
  const tzParam = q.get("tz");
  if (tzParam && !isValidTimeZone(tzParam)) {
    return json({ events: [], error: `Unknown time zone: ${tzParam}` }, 400);
  }
  const body: EventsResponse = await getEvents({ start, end }, tzParam ?? undefined);
  return json(body);
}
