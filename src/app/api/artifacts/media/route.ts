import { checkSameOriginUpload, json } from "@/lib/server/http";
import { MAX_IMAGE_BYTES, readImage, saveImage, sniffImage, typeOf } from "@/lib/server/artifact-media";
import { mediaUrl } from "@/lib/artifacts";

/** POST multipart {file} — an image for an artifact. Returns its URL (the document stores that, never the bytes). */
export async function POST(request: Request) {
  const guard = checkSameOriginUpload(request);
  if (guard) return guard;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "file is required" }, 400);
  if (file.size > MAX_IMAGE_BYTES) return json({ error: "Image is too large (up to 9 MB)" }, 413);
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!sniffImage(buf)) return json({ error: "Only PNG, JPEG, GIF, WebP or AVIF images can go in" }, 415);
  try {
    return json({ url: mediaUrl(await saveImage(buf)) });
  } catch (e) {
    return json({ error: `Couldn't save the image: ${(e as Error).message}` }, 500);
  }
}

/** GET ?name= — an artifact's image. Names are random and never reused, so it caches for good. */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  const buf = await readImage(name);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": typeOf(name),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
    },
  });
}
