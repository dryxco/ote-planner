import { connectorDef } from "@/lib/server/connectors";
import { scheduleTaskSync } from "@/lib/server/connector-jobs";
import { resetTaskSync } from "@/lib/server/task-sync";
import { resetTicketSync } from "@/lib/server/ticket-sync";
import { invalidate } from "@/lib/server/cache";
import { checkSameOrigin, errorMessage, json, readJson } from "@/lib/server/http";
import { updateStore } from "@/lib/server/store";

/** POST {connector, config} — check the settings with the connector, then store them (encrypted). */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const body = await readJson<{ connector?: string; config?: Record<string, unknown> }>(request);
  const def = connectorDef(body?.connector ?? "");
  if (!def) return json({ ok: false, error: "Unknown connector" }, 400);
  const config: Record<string, string> = {};
  for (const f of def.fields) config[f.key] = String(body?.config?.[f.key] ?? "").slice(0, 4000);
  try {
    const r = await def.connect(config);
    await updateStore((s) => {
      s.connector = { connector: def.id, account: r.account, config: r.config ?? config, connectedAt: Date.now() };
    });
    await resetTaskSync();
    await resetTicketSync();
    invalidate("connector:");
    scheduleTaskSync(500);
    return json({ ok: true, account: r.account });
  } catch (e) {
    return json({ ok: false, error: errorMessage(e, `Couldn't connect ${def.label}`) }, 400);
  }
}
