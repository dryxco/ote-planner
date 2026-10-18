// Reference connector: talks to any server that implements the small JSON API in ./README.md
// ("REST connector protocol"). Point it at your own backend, or copy this file as the start of a
// connector for a service with its own API.
import type { CalendarEvent, CalendarInfo, TicketMeta } from "../../types";
import { fetchWithTimeout, networkReason } from "../http";
import {
  StaleError,
  type Connector,
  type ConnectorConnection,
  type ConnectorDef,
  type LoginProvider,
  type RemoteTask,
  type RemoteTicket,
  type TicketComment,
  type TicketHistoryItem,
  type TicketRef,
} from "./types";

type Feature = "tasks" | "tickets" | "calendar";
interface Me {
  id: string;
  label?: string;
  email?: string | null;
  features?: Feature[];
  timeZone?: string;
  rollsOver?: boolean;
}

export class RestError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

const trimUrl = (u: string) => u.trim().replace(/\/+$/, "");
const enc = encodeURIComponent;

async function call<T>(base: string, token: string | null, method: string, p: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  let r: Response;
  try {
    r = await fetchWithTimeout(
      `${base}${p}`,
      {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
      },
      timeoutMs,
    );
  } catch (e) {
    throw new RestError(`Couldn't reach ${base} (${networkReason(e) ?? (e as Error).message})`);
  }
  const j = (await r.json().catch(() => null)) as T & { error?: string };
  if (r.status === 409) throw new StaleError(j?.error ?? "changed there since it was read");
  if (!r.ok) throw new RestError(`${method} ${p}: ${j?.error ?? `HTTP ${r.status}`}`, r.status === 401 || r.status === 403 ? 400 : 502);
  return j as T;
}

/** Stream a file from the server, made safe to serve from Sync's origin. */
async function passFile(base: string, token: string, p: string): Promise<Response> {
  const r = await fetchWithTimeout(`${base}${p}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }, 30_000).catch(() => null);
  if (!r || !r.ok || !r.body) return new Response("not found", { status: r?.status === 404 ? 404 : 502 });
  return new Response(r.body, { status: 200, headers: r.headers });
}

export const restConnector: ConnectorDef = {
  id: "rest",
  label: "REST server",
  description: "Your own server implementing Sync's connector API (see src/lib/server/connectors/README.md).",
  fields: [
    { key: "url", label: "Server URL", placeholder: "https://example.com/sync-api", default: process.env.SYNC_CONNECTOR_URL ?? "" },
    { key: "token", label: "Token", secret: true, placeholder: "Bearer token" },
  ],
  async connect(config) {
    const url = trimUrl(config.url ?? "");
    const token = (config.token ?? "").trim();
    if (!/^https?:\/\//.test(url)) throw new RestError("Enter the server URL (http:// or https://)", 400);
    if (!token) throw new RestError("Enter the token", 400);
    const me = await call<Me>(url, token, "GET", "/me");
    if (!me?.id) throw new RestError("The server's /me didn't return an id", 400);
    return { account: { id: me.id, label: me.label ?? me.email ?? me.id }, config: { url, token } };
  },
  async disconnect(conn) {
    await call(conn.config.url, conn.config.token, "DELETE", "/me/token").catch(() => {});
  },
  open(conn: ConnectorConnection): Connector {
    const base = conn.config.url;
    const token = conn.config.token;
    const api = <T>(method: string, p: string, body?: unknown, timeoutMs?: number) => call<T>(base, token, method, p, body, timeoutMs);
    // capabilities are read once per process and refreshed every 10 minutes
    let me: { at: number; v: Promise<Me> } | null = null;
    const caps = () => {
      if (!me || Date.now() - me.at > 600_000) me = { at: Date.now(), v: api<Me>("GET", "/me") };
      return me.v;
    };
    const has = async (f: Feature) => (await caps()).features?.includes(f) ?? false;

    const calId = (id: string) => `connector:${conn.account.id}:${id}`;
    const calendars = async (): Promise<CalendarInfo[]> => {
      if (!(await has("calendar"))) return [];
      const cals = await api<{ id: string; name: string; color?: string }[]>("GET", "/calendars");
      return cals.map((c) => ({ id: calId(c.id), provider: "connector", accountId: conn.account.id, name: c.name, color: c.color ?? "#30d158" }));
    };
    const ref = (r: TicketRef) => `/tickets/${enc(r.id)}?container=${enc(r.containerId)}`;

    return {
      tasks: {
        timeZone: process.env.SYNC_CONNECTOR_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
        async list() {
          if (!(await has("tasks"))) return { tasks: [], archivedIds: [], complete: false };
          const tz = (await caps()).timeZone;
          if (tz) this.timeZone = tz;
          this.rollsOver = !!(await caps()).rollsOver;
          const r = await api<{ tasks: RemoteTask[]; archivedIds?: string[]; complete?: boolean }>("GET", "/tasks");
          return { tasks: r.tasks ?? [], archivedIds: r.archivedIds ?? [], complete: r.complete !== false };
        },
        create: (t) => api("POST", "/tasks", t),
        update: (id, patch) => api("PATCH", `/tasks/${enc(id)}`, patch),
        remove: (id) => api("DELETE", `/tasks/${enc(id)}`),
      },
      tickets: {
        async meta() {
          if (!(await has("tickets"))) return { projects: [], options: { status: [], priority: [], estimate: [] } };
          return api<TicketMeta>("GET", "/tickets/meta");
        },
        async listMine() {
          if (!(await has("tickets"))) return { tickets: [], complete: false };
          const r = await api<{ tickets: RemoteTicket[]; complete?: boolean }>("GET", "/tickets");
          return { tickets: r.tickets ?? [], complete: r.complete !== false };
        },
        create: (projectId, n) => api<RemoteTicket>("POST", "/tickets", { projectId, ...n }),
        update: (t, n) => api<RemoteTicket>("PATCH", `/tickets/${enc(t.id)}?container=${enc(t.containerId ?? "")}`, { ...n, baseUpdatedAt: t.updatedAt ?? null }),
        detail: (r) => api<{ body: string | null; updatedAt: string; history: TicketHistoryItem[]; comments: TicketComment[] }>("GET", `${ref(r)}&detail=1`),
        saveBody: (r, body, b) => api<{ updatedAt: string }>("PUT", ref(r).replace("?", "/body?"), { body, base: b }),
        async addBodyImages(r, files, b, position) {
          const form = new FormData();
          for (const f of files) form.append("files", f, f.name || "image.png");
          form.append("base", b);
          form.append("position", position);
          const res = await fetchWithTimeout(`${base}${ref(r).replace("?", "/body-images?")}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form, cache: "no-store" }, 60_000);
          const j = (await res.json().catch(() => null)) as { body?: string | null; updatedAt?: string; error?: string } | null;
          if (res.status === 409) throw new StaleError(j?.error ?? "changed there");
          if (!res.ok || !j?.updatedAt) throw new RestError(j?.error ?? `Upload failed (HTTP ${res.status})`);
          return { body: j.body ?? null, updatedAt: j.updatedAt };
        },
        addComment: (r, body) => api<TicketComment>("POST", ref(r).replace("?", "/comments?"), { body }),
        file: (container, id) => passFile(base, token, `/files/${enc(container)}/${enc(id)}`),
        media: (name) => passFile(base, token, `/media/${enc(name)}`),
      },
      calendar: {
        calendars,
        async events(range, tz) {
          const cals = await calendars();
          if (!cals.length) return [];
          const evs = await api<(Omit<CalendarEvent, "provider" | "calendarId" | "color"> & { calendarId: string; color?: string })[]>(
            "GET",
            `/events?from=${range.start}&to=${range.end}${tz ? `&tz=${enc(tz)}` : ""}`,
          );
          const color = new Map(cals.map((c) => [c.id, c.color]));
          return evs.map((e) => {
            const cid = calId(e.calendarId);
            return { ...e, id: `${cid}:${e.id}`, calendarId: cid, provider: "connector" as const, color: e.color ?? color.get(cid) ?? "#30d158" };
          });
        },
      },
    };
  },
};

/** Device-code sign-in against the same API (SYNC_LOGIN_URL, no token needed). */
export function restLogin(url: string, label = "your server"): LoginProvider {
  const base = trimUrl(url);
  return {
    label,
    start: () => call("", null, "POST", `${base}/auth/device/start`, { client: "Sync" }),
    poll: (deviceCode) => call("", null, "POST", `${base}/auth/device/poll`, { deviceCode }),
  };
}
