import { checkSameOrigin, json, readJson } from "@/lib/server/http";
import { runAgent, type AgentImage, type AgentTurn } from "@/lib/server/agent";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 7_000_000; // ~5 MB per image

/** POST /api/agent {history, context} -> {reply, ops} (ops are applied by the browser). */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const body = await readJson<{ history: AgentTurn[]; context: unknown; images?: AgentImage[] }>(request);
  const images = Array.isArray(body?.images) ? body!.images : [];
  if (images.length > MAX_IMAGES) return json({ error: `Up to ${MAX_IMAGES} images per message` }, 413);
  if (images.some((im) => !IMAGE_TYPES.has(im?.media_type) || typeof im.data !== "string" || im.data.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(im.data.slice(0, 200)))) {
    return json({ error: "Images must be PNG, JPEG, GIF or WebP, up to about 5 MB" }, 400);
  }
  const history = Array.isArray(body?.history)
    ? body!.history
        .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.text === "string")
        .slice(-20)
        .map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }))
    : [];
  if (history.length === 0 || history.at(-1)!.role !== "user") return json({ error: "A message is required" }, 400);
  if (JSON.stringify(body?.context ?? null).length > 400_000) return json({ error: "Context is too large" }, 413);
  if (process.env.SYNC_AGENT_FAKE) {
    // tests: echo a canned answer instead of calling Claude
    const fake = JSON.parse(process.env.SYNC_AGENT_FAKE) as { reply: string; ops: unknown[] };
    return json(images.length ? { ...fake, ops: [], reply: `${fake.reply} (${images.length} image: ${images[0].media_type})` } : fake);
  }
  try {
    return json(await runAgent(history, body!.context, images));
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
