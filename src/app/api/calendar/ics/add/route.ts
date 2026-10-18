import { checkSameOrigin, errorMessage, json, readJson } from "@/lib/server/http";
import { feedMeta, fetchFeed, icsAccountId, normalizeIcsUrl } from "@/lib/server/ics-subscriptions";
import { updateStore } from "@/lib/server/store";

const COLORS = ["#4285f4", "#34a853", "#a142f4", "#f4511e", "#0b8043", "#e67c73"];

/** POST /api/calendar/ics/add {url, name?} -> {ok, accountId, name} | {ok:false, error} */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const body = await readJson<{ url?: string; name?: string }>(request);
  if (!body?.url) return json({ ok: false, error: "Enter an iCal address" }, 400);
  try {
    const url = normalizeIcsUrl(body.url);
    const text = await fetchFeed(url, true); // validates it really is a calendar feed
    const meta = feedMeta(text);
    const accountId = icsAccountId(url);
    const name = body.name?.trim() || meta.name || new URL(url).hostname;
    await updateStore((s) => {
      s.ics = s.ics.filter((x) => x.accountId !== accountId);
      s.ics.push({ accountId, url, name, color: meta.color ?? COLORS[s.ics.length % COLORS.length], addedAt: Date.now() });
    });
    return json({ ok: true, accountId, name });
  } catch (e) {
    return json({ ok: false, error: errorMessage(e, "Couldn't add iCal calendar") }, 400);
  }
}
