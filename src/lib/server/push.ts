
// Plan alerts as Web Push (works for the Ote home-screen app on iPhone, iOS 16.4+): 10 minutes
// before a plan starts and right when it ends, even with the app closed. Only devices that turned
// alerts on get them — the iPhone; Apple Watch (and a Mac with iPhone Mirroring) show the iPhone's
// notification, so nothing is sent twice.
import { promises as fs } from "node:fs";
import path from "node:path";
import webpush, { type PushSubscription } from "web-push";
import type { Plan } from "../types";
import { expandPlans } from "../plans";
import { readCollection } from "./syncdb";
import { shared } from "./shared";

const OWNER = "default";
const BEFORE_MIN = 10;
/** Alerts are sent from this far behind (a missed tick / restart still delivers, but not stale ones). */
const LATE_OK_MS = 3 * 60_000;

const dir = () => process.env.OTE_DATA_DIR || path.join(process.cwd(), ".data");
async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir(), name), "utf8")) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(name: string, value: unknown) {
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 });
  const file = path.join(dir(), name);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(tmp, file);
}

// ---- keys & subscriptions ----

interface Vapid {
  publicKey: string;
  privateKey: string;
}
let vapid: Vapid | null = null;
export async function vapidKeys(): Promise<Vapid> {
  if (vapid) return vapid;
  let v = await readJson<Vapid | null>("vapid.json", null);
  if (!v) {
    v = webpush.generateVAPIDKeys();
    await writeJson("vapid.json", v);
  }
  vapid = v;
  return v;
}

export interface PushDevice {
  sub: PushSubscription;
  label: string;
  addedAt: number;
}
export const listDevices = () => readJson<PushDevice[]>("push-subs.json", []);

export async function addDevice(sub: PushSubscription, label: string) {
  const devs = (await listDevices()).filter((d) => d.sub.endpoint !== sub.endpoint);
  devs.push({ sub, label: label.slice(0, 80), addedAt: Date.now() });
  await writeJson("push-subs.json", devs);
}
export async function removeDevice(endpoint: string) {
  await writeJson("push-subs.json", (await listDevices()).filter((d) => d.sub.endpoint !== endpoint));
}

async function send(devs: PushDevice[], payload: object): Promise<number> {
  const keys = await vapidKeys();
  let ok = 0;
  const gone: string[] = [];
  await Promise.all(
    devs.map(async (d) => {
      try {
        await webpush.sendNotification(d.sub, JSON.stringify(payload), {
          vapidDetails: { subject: "mailto:sync@localhost", publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 300, // an alert that can't be delivered within 5 minutes isn't worth showing
          urgency: "high",
        });
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(d.sub.endpoint); // unsubscribed / app removed
        else console.warn(`[sync] push to ${d.label} failed: ${(e as Error).message}`);
      }
    }),
  );
  for (const g of gone) await removeDevice(g);
  return ok;
}

export async function sendTest(endpoint: string) {
  const d = (await listDevices()).find((x) => x.sub.endpoint === endpoint);
  if (!d) throw new Error("This device isn't registered for alerts");
  return send([d], { title: "Ote", body: "Alerts are on for this device.", tag: "sync-test" });
}

// ---- scheduler ----

export interface Alert {
  key: string;
  at: number;
  title: string;
  body: string;
}

/** The alerts plans call for around `now` (pure; used by the job and tests). */
export function dueAlerts(plans: Plan[], names: Map<string, string>, now: number): Alert[] {
  const out: Alert[] = [];
  const fmt = (t: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: process.env.TZ || "Asia/Seoul" }).format(t);
  for (const o of expandPlans(plans, now - LATE_OK_MS - 24 * 3_600_000, now + (BEFORE_MIN + 1) * 60_000)) {
    if (o.plan.allDay) continue;
    const name = o.plan.name?.trim() || names.get(o.plan.activityId) || "Plan";
    const before = o.start - BEFORE_MIN * 60_000;
    if (before <= now && now - before < LATE_OK_MS)
      out.push({ key: `start:${o.key}`, at: before, title: `${name} in ${BEFORE_MIN} min`, body: `${fmt(o.start)} – ${fmt(o.end)}` });
    if (o.end <= now && now - o.end < LATE_OK_MS)
      out.push({ key: `end:${o.key}`, at: o.end, title: `${name} — time's up`, body: `Ended ${fmt(o.end)}. Record what you did in Ote.` });
  }
  return out;
}

const lock = shared("push.lock", () => ({ running: false }));
async function tick() {
  if (lock.running) return;
  lock.running = true;
  try {
    const devs = await listDevices();
    if (devs.length === 0) return;
    const now = Date.now();
    const [planRecs, actRecs] = await Promise.all([readCollection(OWNER, "plans"), readCollection(OWNER, "activities")]);
    const plans = planRecs.filter((r) => !r.deleted).map((r) => r.data as Plan);
    const names = new Map(actRecs.filter((r) => !r.deleted).map((r) => [r.id, (r.data as { name: string }).name]));
    const alerts = dueAlerts(plans, names, now);
    if (alerts.length === 0) return;
    const sent = await readJson<Record<string, number>>("push-sent.json", {});
    for (const a of alerts) {
      if (sent[a.key]) continue;
      sent[a.key] = now; // mark first: never send the same alert twice, even if delivery fails
      await writeJson("push-sent.json", sent);
      await send(devs, { title: a.title, body: a.body, tag: a.key, url: "/" });
    }
    // forget old keys
    for (const [k, t] of Object.entries(sent)) if (now - t > 3 * 86_400_000) delete sent[k];
    await writeJson("push-sent.json", sent);
  } catch (e) {
    console.warn(`[sync] plan alerts failed: ${(e as Error).message}`);
  } finally {
    lock.running = false;
  }
}

const g = globalThis as unknown as { __pushTimer?: ReturnType<typeof setInterval> };
export function startPushJobs() {
  if (g.__pushTimer) return;
  g.__pushTimer = setInterval(() => void tick(), 20_000);
  void tick();
}
