import { checkSameOrigin, json, readJson } from "@/lib/server/http";
import { dropFeed } from "@/lib/server/ics-subscriptions";
import { updateStore } from "@/lib/server/store";

/** POST /api/calendar/ics/remove {accountId} */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const body = await readJson<{ accountId?: string }>(request);
  if (!body?.accountId) return json({ ok: false, error: "accountId is required" }, 400);
  await updateStore((s) => {
    for (const x of s.ics) if (x.accountId === body.accountId) dropFeed(x.url);
    s.ics = s.ics.filter((x) => x.accountId !== body.accountId);
  });
  return json({ ok: true });
}
