import { checkSameOrigin, json, readJson } from "@/lib/server/http";
import { estimateDish } from "@/lib/server/meal-reader";

/** POST {name} -> {dish: {name, amount, kcal, basis}} — the calories of a dish typed in by hand. */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const body = await readJson<{ name?: unknown }>(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120) return json({ error: "name is required (up to 120 characters)" }, 400);
  try {
    const dish = await estimateDish(name);
    return dish ? json({ dish }) : json({ error: "Couldn't work it out" }, 502);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
