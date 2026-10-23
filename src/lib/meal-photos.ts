"use client";

/** Photos for meals: made smaller in the browser (also turns HEIC into JPEG), then uploaded like an artifact's images. */
const MAX_SIDE = 1600;

export async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't read the photo"))), "image/jpeg", 0.85));
}

export async function uploadPhoto(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", await shrink(file), "meal.jpg");
  const r = await fetch("/api/artifacts/media", { method: "POST", headers: { "x-sync-upload": "1" }, body: form });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.url;
}

/** What's in the meal, from its photos (Claude on the server). */
export async function readPhotos(photos: string[]): Promise<{ dishes: { name: string; kcal: number | null }[]; note?: string }> {
  const r = await fetch("/api/meals/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photos }) });
  const j = (await r.json().catch(() => ({}))) as { dishes?: { name: string; kcal: number | null }[]; note?: string; error?: string };
  if (!r.ok || !j.dishes) throw new Error(j.error ?? `HTTP ${r.status}`);
  return { dishes: j.dishes, note: j.note };
}
