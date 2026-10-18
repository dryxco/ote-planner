import { promises as fs } from "node:fs";
import path from "node:path";
import { ticketSource } from "@/lib/server/connector-http";

const NAME = /^[A-Za-z0-9_-]{8,80}\.[A-Za-z0-9]{1,8}$/;
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif|heic)|video\/|audio\/)/i;
const MAX_CACHE_BYTES = 15 * 1024 * 1024; // per file; bigger ones are only streamed
const KEEP_FILES = 600;

// Media names are expected to be unguessable and never reused, so a copy on this server stays valid:
// fetching through the connector can take a second an image, the copy is instant (on every device).
const cacheDir = () => path.join(process.env.OTE_DATA_DIR || path.join(process.cwd(), ".data"), "media-cache");

function headersFor(type: string) {
  const headers = new Headers({ "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
  // served from Ote's origin: only media renders inline; anything else downloads
  if (INLINE.test(type)) headers.set("content-type", type);
  else {
    headers.set("content-type", "application/octet-stream");
    headers.set("content-disposition", "attachment");
  }
  headers.set("content-security-policy", "sandbox; default-src 'none'");
  return headers;
}

async function prune(dir: string) {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => !n.endsWith(".type"));
  if (names.length <= KEEP_FILES) return;
  const stats = await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(path.join(dir, n)).catch(() => null))?.atimeMs ?? 0 })));
  stats.sort((a, b) => a.t - b.t);
  for (const { n } of stats.slice(0, names.length - KEEP_FILES)) {
    await fs.rm(path.join(dir, n), { force: true });
    await fs.rm(path.join(dir, `${n}.type`), { force: true });
  }
}

/** GET ?name= — an image in a ticket's description, fetched through the connector and cached here. */
export async function GET(request: Request) {
  const src = await ticketSource();
  if (src instanceof Response) return src;
  if (!src.media) return new Response("not found", { status: 404 });
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!NAME.test(name)) return new Response("bad name", { status: 400 });
  const dir = cacheDir();
  const file = path.join(dir, name);
  try {
    const [buf, type] = await Promise.all([fs.readFile(file), fs.readFile(`${file}.type`, "utf8")]);
    return new Response(new Uint8Array(buf), { status: 200, headers: headersFor(type) });
  } catch {}
  const r = await src.media(name).catch(() => null);
  if (!r || !r.ok || !r.body) return new Response("not found", { status: r?.status === 404 ? 404 : 502 });
  const type = r.headers.get("content-type") ?? "";
  const len = Number(r.headers.get("content-length") ?? "0");
  if (len && len > MAX_CACHE_BYTES) return new Response(r.body, { status: 200, headers: headersFor(type) });
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength <= MAX_CACHE_BYTES) {
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.writeFile(`${file}.type`, type, { mode: 0o600 });
      await fs.writeFile(file, buf, { mode: 0o600 });
      void prune(dir);
    } catch {}
  }
  return new Response(buf, { status: 200, headers: headersFor(type) });
}
