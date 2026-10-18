import { connection } from "next/server";
import { getCalendars } from "@/lib/server/calendar";
import { json } from "@/lib/server/http";
import type { CalendarsResponse } from "@/lib/types";

export async function GET() {
  await connection();
  const body: CalendarsResponse = {
    ...(await getCalendars()),
    googleOAuth: !!(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()),
  };
  return json(body);
}
