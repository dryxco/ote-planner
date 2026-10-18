// An in-memory server speaking Sync's REST connector protocol (src/lib/server/connectors/README.md).
// For tests — and a compact reference for implementing the protocol on your own backend.
// usage: node scripts/mock-connector.mjs [port=3399]
// Token: "test-token". Test hooks: GET /_state, POST /_approve {userCode, userId, email}, POST /_reset.
import http from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.argv[2] ?? 3399);
const TOKEN = "test-token";
let state;
function reset() {
  state = {
    tasks: new Map(), // id -> RemoteTask
    archived: new Set(),
    tickets: new Map(), // id -> RemoteTicket
    bodies: new Map(), // ticket id -> { body, updatedAt }
    comments: new Map(), // ticket id -> TicketComment[]
    devices: new Map(), // deviceCode -> { userCode, approved: {userId, email} | null }
    revoked: 0,
  };
}
reset();

const META = {
  projects: [
    { id: "web", name: "Website", parentId: null, color: "blue" },
    { id: "web-blog", name: "Blog", parentId: "web", color: null },
  ],
  options: {
    status: [
      { name: "Todo", group: "to_do", color: "gray" },
      { name: "Doing", group: "in_progress", color: "blue" },
      { name: "Done", group: "complete", color: "green" },
    ],
    priority: ["High", "Low"],
    estimate: ["1h", "1d"],
  },
};
const groupOf = (status) => META.options.status.find((s) => s.name === status)?.group ?? "to_do";

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body ?? {}));
};
const readBody = (req) =>
  new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        ok(b ? JSON.parse(b) : {});
      } catch {
        ok({});
      }
    });
  });

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    const m = req.method;

    // ---- test hooks (no auth) ----
    if (p === "/_state") return send(res, 200, { tasks: [...state.tasks.values()], archived: [...state.archived], tickets: [...state.tickets.values()], revoked: state.revoked });
    if (p === "/_reset") return reset(), send(res, 200, { ok: true });
    if (p === "/_approve" && m === "POST") {
      const b = await readBody(req);
      for (const d of state.devices.values()) if (d.userCode === b.userCode) d.approved = { userId: b.userId, email: b.email ?? null };
      return send(res, 200, { ok: true });
    }
    if (p === "/_task" && m === "POST") {
      const b = await readBody(req); // put a task on the board as if made there
      state.tasks.set(b.id, { done: false, date: null, time: null, endTime: null, due: null, ...b });
      return send(res, 200, { ok: true });
    }

    // ---- device-code sign-in (no token) ----
    if (p === "/auth/device/start" && m === "POST") {
      const deviceCode = randomUUID();
      const userCode = Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      state.devices.set(deviceCode, { userCode, approved: null });
      return send(res, 200, { deviceCode, userCode, verificationUri: `http://127.0.0.1:${port}/approve?code=${userCode}`, expiresIn: 600, interval: 1 });
    }
    if (p === "/auth/device/poll" && m === "POST") {
      const b = await readBody(req);
      const d = state.devices.get(b.deviceCode);
      if (!d) return send(res, 200, { status: "expired" });
      if (!d.approved) return send(res, 200, { status: "pending" });
      state.devices.delete(b.deviceCode);
      return send(res, 200, { status: "ok", ...d.approved });
    }

    // ---- everything else needs the token ----
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "bad token" });

    if (p === "/me" && m === "GET") return send(res, 200, { id: "owner-1", label: "owner@example.com", features: ["tasks", "tickets", "calendar"], timeZone: "Asia/Seoul" });
    if (p === "/me/token" && m === "DELETE") return state.revoked++, send(res, 200, { ok: true });

    // tasks
    if (p === "/tasks" && m === "GET") return send(res, 200, { tasks: [...state.tasks.values()], archivedIds: [...state.archived], complete: true });
    if (p === "/tasks" && m === "POST") {
      const t = await readBody(req);
      if (!t.id || state.tasks.has(t.id)) return send(res, 400, { error: "bad id" });
      state.tasks.set(t.id, t);
      return send(res, 201, t);
    }
    let mt = p.match(/^\/tasks\/([^/]+)$/);
    if (mt) {
      const id = decodeURIComponent(mt[1]);
      if (m === "PATCH") {
        const { archived, ...patch } = await readBody(req);
        const cur = state.tasks.get(id);
        if (!cur && !(archived === false && state.archived.has(id))) return send(res, 404, { error: "no task" });
        if (archived === false) state.archived.delete(id);
        state.tasks.set(id, { id, ...(cur ?? {}), ...patch });
        return send(res, 200, state.tasks.get(id));
      }
      if (m === "DELETE") {
        state.tasks.delete(id);
        state.archived.add(id);
        return send(res, 200, { ok: true });
      }
    }

    // tickets
    if (p === "/tickets/meta" && m === "GET") return send(res, 200, META);
    if (p === "/tickets" && m === "GET") return send(res, 200, { tickets: [...state.tickets.values()], complete: true });
    if (p === "/tickets" && m === "POST") {
      const b = await readBody(req);
      const now = Date.now();
      const t = { id: randomUUID(), containerId: `board-${b.projectId}`, projectId: b.projectId, title: b.title, status: b.status, statusGroup: groupOf(b.status), priority: b.priority ?? null, estimate: b.estimate ?? null, due: b.due ?? null, assignees: ["Owner"], author: "Owner", createdAt: now, updatedAt: now };
      state.tickets.set(t.id, t);
      return send(res, 201, t);
    }
    mt = p.match(/^\/tickets\/([^/]+)(\/body|\/comments)?$/);
    if (mt) {
      const id = decodeURIComponent(mt[1]);
      const t = state.tickets.get(id);
      if (!t) return send(res, 404, { error: "no ticket" });
      if (!mt[2] && m === "PATCH") {
        const b = await readBody(req);
        if (b.baseUpdatedAt != null && b.baseUpdatedAt !== t.updatedAt) return send(res, 409, { error: "changed since" });
        Object.assign(t, { title: b.title, status: b.status, statusGroup: groupOf(b.status), priority: b.priority, estimate: b.estimate, due: b.due, updatedAt: Date.now() });
        return send(res, 200, t);
      }
      if (!mt[2] && m === "GET" && u.searchParams.get("detail")) {
        const body = state.bodies.get(id) ?? { body: null, updatedAt: String(t.updatedAt) };
        return send(res, 200, { ...body, history: [{ history_id: "h1", from_name: null, to_name: t.status, event_kind: "created", changed_at: new Date(t.createdAt).toISOString() }], comments: state.comments.get(id) ?? [] });
      }
      if (mt[2] === "/body" && m === "PUT") {
        const b = await readBody(req);
        const cur = state.bodies.get(id);
        if (cur && cur.updatedAt !== b.base) return send(res, 409, { error: "changed since" });
        const next = { body: b.body, updatedAt: String(Date.now()) };
        state.bodies.set(id, next);
        return send(res, 200, { updatedAt: next.updatedAt });
      }
      if (mt[2] === "/comments" && m === "POST") {
        const b = await readBody(req);
        const c = { comment_id: randomUUID(), author_name: "Owner", body: b.body, created_at: new Date().toISOString() };
        state.comments.set(id, [...(state.comments.get(id) ?? []), c]);
        return send(res, 201, c);
      }
    }

    // calendar
    if (p === "/calendars" && m === "GET") return send(res, 200, [{ id: "team", name: "Team schedule", color: "#30d158" }]);
    if (p === "/events" && m === "GET") {
      const from = Number(u.searchParams.get("from"));
      const day = new Date(from);
      day.setHours(15, 0, 0, 0);
      return send(res, 200, [{ id: "standup", calendarId: "team", title: "Team standup", start: day.getTime(), end: day.getTime() + 1800e3, allDay: false }]);
    }

    send(res, 404, { error: `no route ${m} ${p}` });
  })
  .listen(port, "127.0.0.1", () => console.log(`mock connector on http://127.0.0.1:${port}`));
