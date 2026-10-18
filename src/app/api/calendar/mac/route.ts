import { invalidate } from "@/lib/server/cache";
import { checkSameOrigin, errorMessage, json, readJson } from "@/lib/server/http";
import { listMacCalendars } from "@/lib/server/mac-calendar";
import { updateStore } from "@/lib/server/store";

/** POST /api/calendar/mac {enabled} — read calendars from this Mac's Apple Calendar. */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const body = await readJson<{ enabled?: boolean }>(request);
  const enabled = !!body?.enabled;
  try {
    if (enabled) await listMacCalendars(); // fails clearly if the helper or the permission is missing
    await updateStore((s) => {
      s.mac = enabled;
    });
    invalidate("mac:");
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: errorMessage(e, "Couldn't connect Mac calendar") }, 400);
  }
}
