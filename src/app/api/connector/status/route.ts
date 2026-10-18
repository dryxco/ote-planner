import { connection } from "next/server";
import { CONNECTORS } from "@/lib/server/connectors";
import { taskSyncStatus } from "@/lib/server/task-sync";
import { ticketSyncStatus } from "@/lib/server/ticket-sync";
import { json } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

/** GET — the connectors on offer (and what they ask for), the connection, and the last sync runs. */
export async function GET() {
  await connection(); // env / stored connection at request time, never prerendered
  const available = CONNECTORS.map((d) => ({
    id: d.id,
    label: d.label,
    description: d.description ?? null,
    fields: d.fields.map((f) => ({ key: f.key, label: f.label, secret: !!f.secret, placeholder: f.placeholder ?? "", default: f.secret ? "" : (f.default ?? "") })),
  }));
  const c = (await getStore()).connector;
  if (!c) return json({ connected: false, available });
  return json({
    connected: true,
    available,
    connector: c.connector,
    label: CONNECTORS.find((d) => d.id === c.connector)?.label ?? c.connector,
    account: c.account,
    tasks: await taskSyncStatus(),
    tickets: await ticketSyncStatus(),
  });
}
