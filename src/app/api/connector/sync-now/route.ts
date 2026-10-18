import { runConnectorSync } from "@/lib/server/connector-jobs";
import { taskSyncStatus } from "@/lib/server/task-sync";
import { checkSameOrigin, json } from "@/lib/server/http";

export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  await runConnectorSync();
  return json({ ok: true, tasks: await taskSyncStatus() });
}
