import { connectorDef } from "@/lib/server/connectors";
import { resetTaskSync } from "@/lib/server/task-sync";
import { resetTicketSync } from "@/lib/server/ticket-sync";
import { checkSameOrigin, json } from "@/lib/server/http";
import { invalidate } from "@/lib/server/cache";
import { getStore, updateStore } from "@/lib/server/store";

/** POST — forget the connection (the connector may revoke its token). What was synced stays in Sync. */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const c = (await getStore()).connector;
  if (c) await connectorDef(c.connector)?.disconnect?.(c).catch(() => {});
  await updateStore((s) => {
    s.connector = null;
  });
  await resetTaskSync();
  await resetTicketSync();
  invalidate("connector:");
  return json({ ok: true });
}
