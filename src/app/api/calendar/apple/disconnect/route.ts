import { dropAppleSession } from "@/lib/server/apple";
import { invalidate } from "@/lib/server/cache";
import { checkSameOrigin, errorMessage, json, readJson } from "@/lib/server/http";
import { updateStore } from "@/lib/server/store";

/** POST /api/calendar/apple/disconnect {accountId} */
export async function POST(request: Request) {
  const blocked = checkSameOrigin(request);
  if (blocked) return blocked;
  const body = await readJson<{ accountId?: unknown }>(request);
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";
  if (!accountId) return json({ ok: false, error: "accountId is required" }, 400);
  try {
    const found = await updateStore((store) => {
      const before = store.apple.length;
      store.apple = store.apple.filter((a) => a.accountId !== accountId);
      return store.apple.length !== before;
    });
    dropAppleSession(accountId);
    invalidate(`apple:${accountId}:`);
    if (!found) return json({ ok: false, error: "Connected iCloud account not found" }, 404);
    // The app-specific password itself can only be revoked at appleid.apple.com.
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: errorMessage(err, "Couldn't disconnect iCloud") }, 500);
  }
}
