import { checkSameOrigin, json, readJson } from "@/lib/server/http";
import { NAME } from "@/lib/server/artifact-media";
import { MAX_PHOTOS, readMeal } from "@/lib/server/meal-reader";

/** POST {photos: media URLs or names} -> {dishes: [{name, kcal}], note?} — what's in a meal, from its photos. */
export async function POST(request: Request) {
  const guard = checkSameOrigin(request);
  if (guard) return guard;
  const body = await readJson<{ photos?: unknown }>(request);
  const raw = Array.isArray(body?.photos) ? body!.photos : [];
  // a stored photo's name, from its URL (/api/artifacts/media?name=…) or as is
  const names = raw.map((p) => (typeof p === "string" ? (p.includes("name=") ? decodeURIComponent(p.split("name=")[1]) : p) : "")).filter((n) => NAME.test(n));
  if (!names.length || names.length !== raw.length) return json({ error: "photos must be uploaded media" }, 400);
  if (names.length > MAX_PHOTOS) return json({ error: `Up to ${MAX_PHOTOS} photos per meal` }, 413);
  try {
    return json(await readMeal(names));
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
