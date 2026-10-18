import { connection } from "next/server";
import { passwordLogin } from "@/lib/server/auth";
import { loginProvider } from "@/lib/server/connectors";
import { json } from "@/lib/server/http";

/** GET — which sign-ins this server offers (for the login page). */
export async function GET() {
  await connection(); // env / stored connection at request time, never prerendered
  const device = loginProvider();
  return json({ password: passwordLogin(), device: device ? { label: device.label } : null });
}
