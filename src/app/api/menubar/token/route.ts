import { json } from "@/lib/server/http";
import { menubarToken } from "@/lib/server/menubar-token";

/** GET /api/menubar/token -> {token} (session required, via src/proxy.ts): copied in Settings into the Mac app. */
export async function GET() {
  try {
    return json({ token: await menubarToken() });
  } catch (e) {
    return json({ error: `Couldn't create the menu bar token: ${(e as Error).message}` }, 500);
  }
}
