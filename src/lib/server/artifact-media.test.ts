import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NAME, readImage, saveImage, sniffImage } from "./artifact-media";

const bytes = (...xs: (number | string)[]) => new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
const PNG = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);

test("image kind from the bytes; SVG / HTML / text aren't images", () => {
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0)), "jpg");
  assert.equal(sniffImage(bytes("GIF89a")), "gif");
  assert.equal(sniffImage(bytes("RIFF", 0, 0, 0, 0, "WEBP")), "webp");
  assert.equal(sniffImage(bytes(0, 0, 0, 0x1c, "ftypavif")), "avif");
  assert.equal(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  assert.equal(sniffImage(bytes("<html><script>")), null);
  assert.equal(sniffImage(new Uint8Array()), null);
});

test("saved under a random name and read back; other names are refused", async () => {
  process.env.OTE_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "artifact-media-"));
  const name = await saveImage(PNG);
  assert.match(name, NAME);
  assert.deepEqual(new Uint8Array((await readImage(name))!), PNG);
  assert.equal(await readImage("../sync-x.json"), null);
  assert.equal(await readImage("x.png"), null);
  await assert.rejects(saveImage(bytes("<svg>")));
});
