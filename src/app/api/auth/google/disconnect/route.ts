import { invalidate } from "@/lib/server/cache";
import { revokeToken } from "@/lib/server/google";
import { checkSameOrigin, errorMessage, json, readJson } from "@/lib/server/http";
import { updateStore, type GoogleAccountRecord } from "@/lib/server/store";

/** POST /api/auth/google/disconnect {accountId} */
export async function POST(request: Request) {
  const blocked = checkSameOrigin(request);
  if (blocked) return blocked;
  const body = await readJson<{ accountId?: unknown }>(request);
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";
  if (!accountId) return json({ ok: false, error: "accountId is required" }, 400);
  try {
    const removed = await updateStore<GoogleAccountRecord | undefined>((store) => {
      const acc = store.google.find((a) => a.accountId === accountId);
      store.google = store.google.filter((a) => a.accountId !== accountId);
      return acc;
    });
    invalidate(`google:${accountId}:`);
    if (!removed) return json({ ok: false, error: "Connected Google account not found" }, 404);
    await revokeToken(removed.refreshToken);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: errorMessage(err, "Couldn't disconnect Google") }, 500);
  }
}
