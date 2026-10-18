// In-progress device-code sign-ins, keyed by a random id kept in an httpOnly cookie. Process memory
// only: a restart just means starting the sign-in again.
import { randomBytes } from "node:crypto";

export interface PendingLogin {
  deviceCode: string;
  expiresIn: number;
  interval: number;
  createdAt: number;
  nextPollAt: number;
  tailscaleLogin: string | null;
}

const g = globalThis as unknown as { __syncPendingLogins?: Map<string, PendingLogin> };
const pending = (g.__syncPendingLogins ??= new Map());

export function addPending(p: PendingLogin): string {
  const now = Date.now();
  for (const [k, v] of pending) if (v.createdAt + v.expiresIn * 1000 < now) pending.delete(k);
  if (pending.size > 50) pending.delete(pending.keys().next().value!);
  const id = randomBytes(24).toString("base64url");
  pending.set(id, p);
  return id;
}

export function getPending(id: string | null): PendingLogin | null {
  if (!id) return null;
  const p = pending.get(id);
  if (!p) return null;
  if (p.createdAt + p.expiresIn * 1000 < Date.now()) {
    pending.delete(id);
    return null;
  }
  return p;
}

export function removePending(id: string | null) {
  if (id) pending.delete(id);
}
