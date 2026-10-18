import { appleAccountId, verifyApple } from "@/lib/server/apple";
import { invalidate } from "@/lib/server/cache";
import { checkSameOrigin, errorMessage, json, ProviderError, readJson } from "@/lib/server/http";
import { updateStore } from "@/lib/server/store";

/** POST /api/calendar/apple/connect {appleId, appPassword} -> {ok, accountId} | {ok:false, error} */
export async function POST(request: Request) {
  const blocked = checkSameOrigin(request);
  if (blocked) return blocked;
  const body = await readJson<{ appleId?: unknown; appPassword?: unknown }>(request);
  const appleId = typeof body?.appleId === "string" ? body.appleId.trim() : "";
  const appPassword = typeof body?.appPassword === "string" ? body.appPassword.trim() : "";
  if (!appleId || !appPassword) {
    return json({ ok: false, error: "Enter both your Apple ID and app-specific password" }, 400);
  }

  try {
    await verifyApple(appleId, appPassword);
  } catch (err) {
    // Credentials rejected or iCloud unreachable: report the reason, store nothing.
    const status = err instanceof ProviderError && err.needsReconnect ? 401 : 502;
    return json({ ok: false, error: errorMessage(err, "Couldn't connect iCloud") }, status);
  }

  const accountId = appleAccountId(appleId);
  try {
    await updateStore((store) => {
      const existing = store.apple.find((a) => a.accountId === accountId);
      store.apple = [
        ...store.apple.filter((a) => a.accountId !== accountId),
        { accountId, appleId, appPassword, connectedAt: existing?.connectedAt ?? Date.now() },
      ];
    });
  } catch (err) {
    return json({ ok: false, error: errorMessage(err, "Couldn't save connection") }, 500);
  }
  invalidate(`apple:${accountId}:`);
  return json({ ok: true, accountId });
}
