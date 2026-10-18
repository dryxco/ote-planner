// Fills a THROWAWAY Sync server with a made-up example day: today's plans and actuals, a few to-dos,
// a project with tickets, a goal and a diary note — for trying Sync out.
//   --weeks=3  also the weeks before and after (for the Review / Goals screenshots in the README)
// usage: SYNC_TEST_SESSION=<cookie> node scripts/demo-data.mjs <base url> [--weeks=3]
// Never point it at your real server: it adds records next to yours.
import { createHash } from "node:crypto";

// the same ids every run: running it again updates the example instead of adding a second copy
// (each browser keeps its own copy of the data and would sync the old one back)
let idN = 0;
const randomUUID = () => {
  const h = createHash("sha256").update(`sync-demo:${idN++}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const base = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://127.0.0.1:3302";
const weeks = Number(process.argv.find((a) => a.startsWith("--weeks="))?.split("=")[1] ?? 0);
const cookie = process.env.SYNC_TEST_SESSION ? `sync_session=${process.env.SYNC_TEST_SESSION}` : "";
const DAY = 86_400_000;
const today = new Date();
today.setHours(0, 0, 0, 0);
const T = today.getTime();
const at = (d, h, m = 0) => T + d * DAY + (h * 60 + m) * 60_000;
const now = Date.now();
// steady pseudo-randomness, so the screenshots come out the same each time
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = (max) => Math.round((rnd() * 2 - 1) * max) * 60_000;

const A = {
  sleep: ["Sleep", "#76767c"],
  work: ["Work", "#2f7fd8"],
  exercise: ["Exercise", "#e3933a"],
  reading: ["Reading", "#3cb563"],
  meal: ["Meal", "#c9a046"],
  commute: ["Commute", "#30b0c7"],
  other: ["Other", "#5f5f64"],
};
const changes = [];
const put = (col, data) => changes.push({ col, id: data.id, updatedAt: now, data });
Object.entries(A).forEach(([id, [name, color]], order) => put("activities", { id, name, color, order, reminder: "none", endConfirmation: id === "work" || id === "exercise" }));

const plan = (name, act, start, end) => put("plans", { id: randomUUID(), name, activityId: act, color: A[act][1], allDay: false, start, end, repeat: "never", reminder: "activity", endConfirmation: "activity", createdAt: now });
const actual = (name, act, start, end) => put("actuals", { id: randomUUID(), name, activityId: act, color: A[act][1], start, end, createdAt: now });

// a weekday routine; what actually happened drifts a little, and some days slip
const routine = (d) => {
  const weekend = new Date(T + d * DAY).getDay() === 6; // Saturdays off
  return weekend
    ? [["Long run", "exercise", 9, 0, 10, 30], ["Brunch", "meal", 11, 0, 12, 0], ["Novel", "reading", 15, 0, 16, 30], ["Dinner", "meal", 19, 0, 20, 0]]
    : [
        ["Gym", "exercise", 7, 0, 8, 0],
        ["Commute", "commute", 8, 30, 9, 10],
        ["Deep work", "work", 9, 30, 12, 0],
        ["Lunch", "meal", 12, 0, 13, 0],
        ["Design review", "work", 13, 30, 15, 0],
        ["Writing", "work", 15, 30, 17, 30],
        ["Commute", "commute", 18, 0, 18, 40],
        ["Reading", "reading", 21, 30, 22, 30],
      ];
};
for (let d = weeks ? -7 * weeks + 1 : 0; d <= (weeks ? 6 : 0); d++) {
  for (const [name, act, sh, sm, eh, em] of routine(d)) {
    const s = at(d, sh, sm);
    const e = at(d, eh, em);
    plan(name, act, s, e);
    if (s > now) continue;
    if (rnd() < 0.12) continue; // skipped
    const as = s + jitter(20);
    const ae = Math.min(now, Math.max(as + 15 * 60_000, e + jitter(25)));
    actual(name === "Deep work" && rnd() < 0.3 ? "Email" : name, name === "Deep work" && rnd() < 0.3 ? "other" : act, as, ae);
  }
  if (at(d, 0) < now) actual("Sleep", "sleep", at(d - 1, 23, 30) + jitter(30), at(d, 6, 40) + jitter(20));
}

// projects, to-dos, tickets
const launch = randomUUID();
const home = randomUUID();
put("campaigns", { id: launch, name: "Launch the beta", start: T - 10 * DAY, due: T + 12 * DAY, activityIds: ["work"], tags: ["local:site"], order: 0, createdAt: now });
put("campaigns", { id: home, name: "Move apartments", due: T + 25 * DAY, activityIds: [], tags: [], order: 1, createdAt: now });
const todo = (name, o = {}) => put("todos", { id: randomUUID(), name, activityId: o.act ?? "work", color: A[o.act ?? "work"][1], done: false, createdAt: now - (o.age ?? 0), ...o.extra });
todo("Write release notes", { extra: { date: T, time: 16 * 60, duration: 45, campaignId: launch } });
todo("Fix sign-up email", { extra: { date: T, campaignId: launch, done: true, doneAt: now - 3600e3 } });
todo("Record demo video", { extra: { date: T + DAY, campaignId: launch } });
todo("Book movers", { act: "other", extra: { date: T, campaignId: home } });
todo("Cancel internet plan", { act: "other", extra: { campaignId: home } });
todo("Buy running shoes", { act: "exercise" });
todo("Call the bank", { act: "other", extra: { date: T - DAY, missed: [T - DAY] } });
const ticket = (title, status, group, o = {}) =>
  put("tickets", { id: randomUUID(), projectId: "local:site", projectName: "Website", local: true, title, status, statusGroup: group, createdAt: now - (o.age ?? 2) * DAY, statusSince: now - (o.since ?? 1) * DAY, priority: o.priority ?? null, due: o.due ?? null, ...(o.campaign ? { campaignId: launch } : {}) });
ticket("Pricing page copy", "Not started", "to_do", { priority: "High", due: new Date(T + 3 * DAY).toISOString().slice(0, 10), campaign: true });
ticket("Dark mode for the docs", "Not started", "to_do", { priority: "Low" });
ticket("Onboarding checklist", "In progress", "in_progress", { priority: "Urgent", campaign: true });
ticket("Status page", "In review", "in_progress", { priority: "Medium" });
ticket("New logo in the footer", "Done", "complete", { since: 0, campaign: true });

// goals for this and last week, and this month
const weekStart = T - today.getDay() * DAY;
for (const ws of weeks ? [weekStart - 7 * DAY] : []) {
  put("goals", { id: randomUUID(), period: "week", periodStart: ws, kind: "time", activityId: "work", target: 25 * 60, createdAt: now });
  put("goals", { id: randomUUID(), period: "week", periodStart: ws, kind: "count", activityId: "exercise", target: 4, createdAt: now });
  put("goals", { id: randomUUID(), period: "week", periodStart: ws, kind: "time", activityId: "reading", target: 5 * 60, createdAt: now });
  put("goals", { id: randomUUID(), period: "week", periodStart: ws, kind: "onTime", activityId: "exercise", target: 0, createdAt: now });
}
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
put("goals", { id: randomUUID(), period: "week", periodStart: weekStart, kind: "time", activityId: "work", target: 25 * 60, createdAt: now });
put("goals", { id: randomUUID(), period: "week", periodStart: weekStart, kind: "count", activityId: "exercise", target: 4, createdAt: now });
put("goals", { id: randomUUID(), period: "month", periodStart: monthStart, kind: "onTime", activityId: "work", target: 0, createdAt: now });
put("goals", { id: randomUUID(), period: "month", periodStart: monthStart, kind: "time", activityId: "reading", target: 20 * 60, createdAt: now });

// diary
const notes = [
  [0, "Shipped the onboarding checklist to review. Long walk after dinner — the first cold evening this fall."],
  [-1, "Slow morning, but the design review went well. Decided to cut the pricing page down to one plan."],
  [-2, "Ran 8 km by the river. Read two chapters before bed."],
  [-4, "Movers quoted. Need to pack the books first."],
  [-6, "Too many meetings. Tomorrow: protect the morning."],
  [-9, "Started the beta plan. Feels doable."],
];
for (const [d, text] of notes.filter(([d]) => weeks || d === 0)) put("diary", { id: randomUUID(), date: T + d * DAY, text, updatedAt: now });

changes.push({ col: "meta", id: "settings", updatedAt: now, data: { localProjects: [{ id: "local:site", name: "Website", color: "blue" }] } });

const r = await fetch(`${base}/api/sync`, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie }, body: JSON.stringify({ since: 0, changes }) });
if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
console.log(`added ${changes.length} sample records to ${base}`);
