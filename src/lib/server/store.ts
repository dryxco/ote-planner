// Encrypted credential store: .data/integrations.json, AES-256-GCM, key from OTE_SECRET.
// Single-user app: one file, serialized writes within the process. Never log contents.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { shared } from "./shared";
import type { ConnectorConnection } from "./connectors/types";

export interface GoogleAccountRecord {
  /** Google `sub` (stable user id). */
  accountId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when accessToken expires. */
  expiresAt: number;
  scope: string;
  connectedAt: number;
}

export interface AppleAccountRecord {
  accountId: string;
  appleId: string;
  appPassword: string;
  connectedAt: number;
}

/** A calendar subscribed by its iCal (.ics) link, e.g. Google's "secret address in iCal format". */
export interface IcsSubscriptionRecord {
  accountId: string;
  /** Secret-bearing URL: never log or send to the client. */
  url: string;
  name: string;
  color: string;
  addedAt: number;
}

export interface IntegrationStore {
  google: GoogleAccountRecord[];
  apple: AppleAccountRecord[];
  ics: IcsSubscriptionRecord[];
  /** The outside service tasks / tickets / events are mirrored with (connectors/). */
  connector: ConnectorConnection | null;
  /** Read calendars from this Mac's Apple Calendar (EventKit helper). */
  mac: boolean;
}

interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

// OTE_DATA_DIR (test servers) must isolate this store too — not just sessions and sync data.
export const dataDir = () => process.env.OTE_DATA_DIR || path.join(process.cwd(), ".data");
const storeFile = () => path.join(dataDir(), "integrations.json");
const devSecretFile = () => path.join(dataDir(), "dev-secret");

let keyPromise: Promise<Buffer> | null = null;

async function loadKey(): Promise<Buffer> {
  let secret = process.env.OTE_SECRET?.trim();
  if (!secret) {
    // Dev fallback: a random secret persisted next to the data so restarts can still decrypt.
    // This only obscures the file; anyone with .data/ can read the tokens.
    await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 });
    try {
      secret = (await fs.readFile(devSecretFile(), "utf8")).trim();
    } catch {
      secret = randomBytes(32).toString("base64url");
      await fs.writeFile(devSecretFile(), secret, { mode: 0o600 });
    }
    console.warn(
      "\n" +
        "==================================================================\n" +
        " [sync] WARNING: OTE_SECRET is not set.\n" +
        " Calendar credentials are encrypted with a generated dev key stored\n" +
        " in .data/dev-secret (same folder as the data). Set OTE_SECRET\n" +
        " (e.g. `openssl rand -base64 32`) before using real accounts.\n" +
        " Changing it later makes existing connections unreadable.\n" +
        "==================================================================\n",
    );
  }
  return createHash("sha256").update(`sync-integrations:v1:${secret}`).digest();
}

function key(): Promise<Buffer> {
  if (!keyPromise) {
    keyPromise = loadKey().catch((err) => {
      keyPromise = null;
      throw err;
    });
  }
  return keyPromise;
}

function empty(): IntegrationStore {
  return { google: [], apple: [], ics: [], connector: null, mac: false };
}

export class StoreError extends Error {}

async function readStore(): Promise<IntegrationStore> {
  let raw: string;
  try {
    raw = await fs.readFile(storeFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw err;
  }
  const k = await key();
  try {
    const env = JSON.parse(raw) as Envelope;
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(env.data, "base64")), decipher.final()]);
    const parsed = JSON.parse(plain.toString("utf8")) as Partial<IntegrationStore>;
    return { google: parsed.google ?? [], apple: parsed.apple ?? [], ics: parsed.ics ?? [], connector: parsed.connector ?? null, mac: parsed.mac ?? false };
  } catch {
    throw new StoreError(
      "Can't decrypt saved calendar connections (OTE_SECRET changed or .data/integrations.json is corrupted). " +
        "Restore the original OTE_SECRET, or delete .data/integrations.json and reconnect.",
    );
  }
}

async function writeStore(store: IntegrationStore): Promise<void> {
  const k = await key();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(store), "utf8"), cipher.final()]);
  const env: Envelope = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const tmp = `${storeFile()}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(env), { mode: 0o600 });
  await fs.rename(tmp, storeFile());
}

// Serialize all access so read-modify-write cycles don't interleave.
const q = shared("store.queue", () => ({ queue: Promise.resolve() as Promise<unknown> }));

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = q.queue.then(fn, fn);
  q.queue = run.catch(() => undefined);
  return run;
}

export function getStore(): Promise<IntegrationStore> {
  return serialized(readStore);
}

/** Atomically read, mutate and persist the store. */
export function updateStore<T>(mutate: (store: IntegrationStore) => T | Promise<T>): Promise<T> {
  return serialized(async () => {
    const store = await readStore();
    const result = await mutate(store);
    await writeStore(store);
    return result;
  });
}
