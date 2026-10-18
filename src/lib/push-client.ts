"use client";

/** This device's plan alerts (Web Push). Flag in localStorage so in-app reminders don't double up. */
export const PUSH_FLAG = "sync-push-on";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

/** iOS only delivers web push to the Home Screen app (standalone). */
export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Mac/.test(ua) ? "Mac" : "Device";
}

export async function enablePush(): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for Ote in Settings" : "Permission wasn't granted");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const { publicKey } = (await (await fetch("/api/push", { cache: "no-store" })).json()) as { publicKey: string };
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
  const r = await fetch("/api/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), label: deviceLabel() }),
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
  try {
    localStorage.setItem(PUSH_FLAG, "1");
  } catch {}
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", endpoint: sub.endpoint }) });
    await sub.unsubscribe().catch(() => {});
  }
  try {
    localStorage.removeItem(PUSH_FLAG);
  } catch {}
}

export async function testPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) throw new Error("Alerts aren't on for this device");
  const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "test", endpoint: sub.endpoint }) });
  const b = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok || !b.ok) throw new Error(b.error ?? "The test alert couldn't be sent");
}

export function pushOnHere(): boolean {
  try {
    return localStorage.getItem(PUSH_FLAG) === "1";
  } catch {
    return false;
  }
}
