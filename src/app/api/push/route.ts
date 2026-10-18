import { checkSameOrigin, json, readJson } from "@/lib/server/http";
import { addDevice, listDevices, removeDevice, sendTest, vapidKeys } from "@/lib/server/push";
import type { PushSubscription } from "web-push";

/** GET /api/push -> {publicKey, devices:[{label, endpointTail}]} */
export async function GET() {
  const [{ publicKey }, devs] = await Promise.all([vapidKeys(), listDevices()]);
  return json({ publicKey, devices: devs.map((d) => ({ label: d.label, endpoint: d.sub.endpoint, addedAt: d.addedAt })) });
}

/** POST /api/push {action: "subscribe" | "unsubscribe" | "test", subscription?, endpoint?, label?} */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const body = await readJson<{ action?: string; subscription?: PushSubscription; endpoint?: string; label?: string }>(request);
  try {
    if (body?.action === "subscribe") {
      const s = body.subscription;
      if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return json({ error: "Invalid subscription" }, 400);
      await addDevice({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, body.label || "Device");
      return json({ ok: true });
    }
    if (body?.action === "unsubscribe" && body.endpoint) {
      await removeDevice(body.endpoint);
      return json({ ok: true });
    }
    if (body?.action === "test" && body.endpoint) {
      return json({ ok: (await sendTest(body.endpoint)) > 0 });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
