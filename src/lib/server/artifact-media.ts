// Images put into artifacts: stored under the data dir (artifact-media/), served back from Ote's own
// origin. The type is read from the file's first bytes, not trusted from the browser, and only plain
// raster images are kept (no SVG: it can carry script).
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const MAX_IMAGE_BYTES = 9 * 1024 * 1024; // the proxy buffers request bodies up to 10MB
export const NAME = /^[A-Za-z0-9_-]{24}\.(png|jpg|gif|webp|avif)$/;

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };

export const mediaDir = () => path.join(process.env.OTE_DATA_DIR || path.join(process.cwd(), ".data"), "artifact-media");

/** The image kind from its first bytes, or null when it isn't one we keep. */
export function sniffImage(b: Uint8Array): keyof typeof TYPES | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(0, 6))) return "gif";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "avif";
  return null;
}

export const typeOf = (name: string) => TYPES[name.split(".").pop() ?? ""] ?? "application/octet-stream";

/** Keep an uploaded image; returns its stored name. */
export async function saveImage(buf: Uint8Array): Promise<string> {
  const kind = sniffImage(buf);
  if (!kind) throw new Error("not an image");
  const name = `${randomBytes(18).toString("base64url")}.${kind}`;
  await fs.mkdir(mediaDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(mediaDir(), name), buf, { mode: 0o600, flag: "wx" });
  return name;
}

/** A stored image (null when there's none by that name). */
export async function readImage(name: string): Promise<Buffer | null> {
  if (!NAME.test(name)) return null;
  return fs.readFile(path.join(mediaDir(), name)).catch(() => null);
}
