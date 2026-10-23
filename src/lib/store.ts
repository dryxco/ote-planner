"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Activity, Actual, Artifact, Campaign, DiaryEntry, Goal, Plan, Settings, Ticket, Timer, Todo } from "./types";
import { parseOccurrenceKey } from "./plans";
import { moveKeys, nextOrder } from "./artifacts";
import { MIN, logicalDate, startOfDay } from "./time";

export const PALETTE = ["#5f5f64", "#76767c", "#2f7fd8", "#e3933a", "#3cb563", "#a3a3a8", "#c9a046", "#30b0c7"];

const DEFAULT_ACTIVITIES: Activity[] = [
  { id: "sleep", name: "Sleep", color: "#76767c", order: 0, reminder: "none", endConfirmation: false },
  { id: "work", name: "Work", color: "#2f7fd8", order: 1, reminder: "none", endConfirmation: false },
  { id: "exercise", name: "Exercise", color: "#e3933a", order: 2, reminder: "none", endConfirmation: false },
  { id: "reading", name: "Reading", color: "#3cb563", order: 3, reminder: "none", endConfirmation: false },
  { id: "travel", name: "Travel", color: "#a3a3a8", order: 4, reminder: "none", endConfirmation: false },
  { id: "meal", name: "Meal", color: "#c9a046", order: 5, reminder: "none", endConfirmation: false },
  { id: "commute", name: "Commute", color: "#30b0c7", order: 6, reminder: "none", endConfirmation: false },
  { id: "other", name: "Other", color: "#5f5f64", order: 7, reminder: "none", endConfirmation: false },
];

export const OTHER_ID = "other";

const DEFAULT_SETTINGS: Settings = {
  dayStart: 5 * 60,
  dayClose: 60,
  weekStartsOn: 0,
  defaultReminder: "none",
  defaultEndConfirmation: false,
  showCalendarEvents: true,
  hiddenCalendarIds: [],
  hiddenEventIds: [],
};

/** A "#" project made in Ote (see `Settings.localProjects`). */
export const isLocalProject = (id: string | undefined) => !!id?.startsWith("local:");

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export interface SyncState {
  activities: Activity[];
  plans: Plan[];
  actuals: Actual[];
  todos: Todo[];
  goals: Goal[];
  diary: DiaryEntry[];
  /** Tickets: in projects of my own, and the connector's assigned to me (mirrored by the server). */
  tickets: Ticket[];
  /** Projects: campaigns of tasks and tickets. */
  campaigns: Campaign[];
  /** Documents linked to projects (see `Artifact`). */
  artifacts: Artifact[];
  timer: Timer | null;
  settings: Settings;

  addPlan(p: Omit<Plan, "id" | "createdAt">): string;
  updatePlan(id: string, patch: Partial<Plan>): void;
  deletePlan(id: string): void;
  /** Remove a single occurrence of a repeating plan. */
  skipOccurrence(planId: string, start: number): void;
  dismissOccurrence(planId: string, start: number): void;

  addActual(a: Omit<Actual, "id" | "createdAt">): string;
  updateActual(id: string, patch: Partial<Actual>): void;
  deleteActual(id: string): void;

  addTodo(t: Omit<Todo, "id" | "createdAt" | "done">): string;
  updateTodo(id: string, patch: Partial<Todo>): void;
  toggleTodo(id: string): void;
  deleteTodo(id: string): void;
  /** Unfinished to-dos whose day has passed move to No date (the day is kept in `missed`). */
  rollOverTodos(today: number): void;
  /** Duplicate a to-do as another branch of its group (same details, no time). Returns the new id. */
  branchTodo(id: string): string | null;
  /** Branches made without their main's project / note (before 10/12) get them back. Idempotent. */
  repairBranchShared(): void;
  /** Put a branch at `index` among its main's branches (0 = right under the main). */
  moveBranch(id: string, index: number): void;

  /** A new ticket on a project (on a connector's, the server files it there and assigns it to the owner). */
  addTicket(t: { projectId: string; projectName?: string; title: string }): string;
  /** A Ote-only "#" project (my own tickets, never sent anywhere); returns its id. */
  addLocalProject(name: string): string;
  /** Rename one of my "#" projects (its tickets follow). */
  renameLocalProject(id: string, name: string): void;
  /** Remove one of my "#" projects; its tickets are hidden (kept in the data) and projects unlink it. */
  deleteLocalProject(id: string): void;
  updateTicket(id: string, patch: Partial<Ticket>): void;
  /** Remove from Ote only (the board keeps it: a token can't delete tickets). */
  hideTicket(id: string): void;

  addCampaign(c: Omit<Campaign, "id" | "createdAt">): string;
  updateCampaign(id: string, patch: Partial<Campaign>): void;
  /** Its tasks and tickets stay, out of any project; its artifacts go with it. */
  deleteCampaign(id: string): void;

  /** A new, empty artifact at the end of the project's; returns its id. */
  addArtifact(campaignId: string, title?: string): string;
  updateArtifact(id: string, patch: Partial<Pick<Artifact, "title" | "body">>): void;
  deleteArtifact(id: string): void;
  /** Move an artifact to another project ("" = none), last among that project's. */
  moveArtifactTo(id: string, campaignId: string): void;
  /** Put an artifact at `index` among its project's (0 = first), back in its project's line on the canvas. */
  moveArtifact(id: string, index: number): void;
  /** Leave its node where it was dragged on the canvas (`y` below its project card's top). */
  placeArtifact(id: string, at: { x: number; y: number }): void;

  addGoal(g: Omit<Goal, "id" | "createdAt">): string;
  updateGoal(id: string, patch: Partial<Goal>): void;
  deleteGoal(id: string): void;

  addActivity(a: Omit<Activity, "id" | "order">): string;
  updateActivity(id: string, patch: Partial<Activity>): void;
  deleteActivity(id: string): void;
  reorderActivities(ids: string[]): void;

  startTimer(t: Omit<Timer, "start">): void;
  /** Stop and record the actual; `endAt` caps the end (a pomodoro that ended while the app was closed). */
  stopTimer(endAt?: number): string | null;
  cancelTimer(): void;

  updateSettings(patch: Partial<Settings>): void;
  /** Write the day's note (empty text removes it). */
  setDiary(date: number, text: string): void;
  /** Hide one calendar event's ghost (the event itself is untouched). */
  hideEvent(eventId: string): void;
  /** A calendar event that didn't happen: kept as planned, no tentative actual for it. */
  skipEvent(eventId: string): void;
}

export const useSync = create<SyncState>()(
  persist(
    (set, get) => ({
      activities: DEFAULT_ACTIVITIES,
      plans: [],
      actuals: [],
      todos: [],
      goals: [],
      diary: [],
      tickets: [],
      campaigns: [],
      artifacts: [],
      timer: null,
      settings: DEFAULT_SETTINGS,

      addPlan(p) {
        const id = uid();
        set((s) => ({ plans: [...s.plans, { ...p, id, createdAt: Date.now() }] }));
        return id;
      },
      updatePlan(id, patch) {
        set((s) => ({ plans: s.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
      },
      deletePlan(id) {
        // A plan made from a calendar event: deleting it shouldn't bring the event's ghost back.
        const src = get().plans.find((p) => p.id === id)?.sourceEventId;
        if (src) get().hideEvent(src);
        set((s) => ({
          plans: s.plans.filter((p) => p.id !== id),
          todos: s.todos.map((t) => (t.planId === id ? { ...t, planId: undefined } : t)),
          actuals: s.actuals.map((a) =>
            a.planKey && parseOccurrenceKey(a.planKey).planId === id ? { ...a, planKey: undefined } : a,
          ),
        }));
      },
      skipOccurrence(planId, start) {
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === planId ? { ...p, exceptions: [...(p.exceptions ?? []), start] } : p,
          ),
        }));
      },
      dismissOccurrence(planId, start) {
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === planId ? { ...p, dismissed: [...(p.dismissed ?? []), start] } : p,
          ),
        }));
      },

      addActual(a) {
        const id = uid();
        const rec: Actual = { ...a, id, createdAt: Date.now() };
        // Done without a plan (typed in, a timer, a pomodoro): it also goes in as a finished task.
        let todo: Todo | undefined;
        if (!a.planKey && !a.sourceEventId && !a.todoId) {
          todo = { ...todoFieldsOf(rec, get().activities), id: uid(), done: true, doneAt: a.end, fromActual: id, createdAt: Date.now() };
          rec.todoId = todo.id;
        }
        set((s) => ({ actuals: [...s.actuals, rec], ...(todo ? { todos: [...s.todos, todo] } : {}) }));
        return id;
      },
      updateActual(id, patch) {
        set((s) => {
          const actuals = s.actuals.map((a) => (a.id === id ? { ...a, ...patch } : a));
          const a = actuals.find((x) => x.id === id);
          // its automatic task follows (name, activity, time)
          const todos = a?.todoId ? s.todos.map((t) => (t.id === a.todoId && t.fromActual === id ? { ...t, ...todoFieldsOf(a, s.activities) } : t)) : s.todos;
          return { actuals, todos };
        });
      },
      deleteActual(id) {
        set((s) => ({ actuals: s.actuals.filter((a) => a.id !== id), todos: s.todos.filter((t) => t.fromActual !== id) }));
      },

      addTicket(t) {
        const id = uid();
        const now = Date.now();
        const local = isLocalProject(t.projectId) || undefined;
        set((s) => ({ tickets: [...(s.tickets ?? []), { ...t, id, local, status: local ? "Not started" : "", statusGroup: "to_do", createdAt: now, updatedAt: now }] }));
        return id;
      },
      renameLocalProject(id, name) {
        const n = name.trim();
        if (!n) return;
        const now = Date.now();
        set((s) => ({
          settings: { ...s.settings, localProjects: (s.settings.localProjects ?? []).map((p) => (p.id === id ? { ...p, name: n } : p)) },
          tickets: (s.tickets ?? []).map((t) => (t.projectId === id ? { ...t, projectName: n, updatedAt: now } : t)),
        }));
      },
      deleteLocalProject(id) {
        const now = Date.now();
        set((s) => ({
          settings: { ...s.settings, localProjects: (s.settings.localProjects ?? []).filter((p) => p.id !== id) },
          tickets: (s.tickets ?? []).map((t) => (t.projectId === id && !t.hidden ? { ...t, hidden: true, updatedAt: now } : t)),
          campaigns: (s.campaigns ?? []).map((c) => (c.tags.includes(id) ? { ...c, tags: c.tags.filter((x) => x !== id) } : c)),
        }));
      },
      addLocalProject(name) {
        const id = `local:${uid()}`;
        set((s) => ({ settings: { ...s.settings, localProjects: [...(s.settings.localProjects ?? []), { id, name: name.trim() }] } }));
        return id;
      },
      updateTicket(id, patch) {
        const now = Date.now();
        set((s) => ({
          tickets: (s.tickets ?? []).map((x) =>
            x.id === id
              ? {
                  ...x,
                  ...patch,
                  ...(patch.status && patch.status !== x.status ? { statusSince: now } : {}),
                  // finished here: list it under today's Done until the connector's own time comes back
                  ...(patch.statusGroup && patch.statusGroup !== x.statusGroup ? { completedAt: patch.statusGroup === "complete" ? now : null } : {}),
                  updatedAt: now,
                }
              : x,
          ),
        }));
      },
      hideTicket(id) {
        set((s) => ({ tickets: (s.tickets ?? []).map((x) => (x.id === id ? { ...x, hidden: true, updatedAt: Date.now() } : x)) }));
      },
      addTodo(t) {
        const id = uid();
        set((s) => ({ todos: [...s.todos, { ...t, id, done: false, createdAt: Date.now() }] }));
        return id;
      },
      updateTodo(id, patch) {
        set((s) => {
          const t = s.todos.find((x) => x.id === id);
          // branches share activity / color / deadline across the group; each keeps its own name
          const shared = Object.fromEntries(Object.entries(patch).filter(([k]) => BRANCH_SHARED.has(k)));
          const root = t ? (t.branchOf ?? t.id) : null;
          return {
            todos: s.todos.map((x) =>
              x.id === id ? { ...x, ...patch, ...("date" in patch && patch.date !== x.date && x.datedOnDone ? { datedOnDone: undefined } : {}) } : root && Object.keys(shared).length && (x.id === root || x.branchOf === root) ? { ...x, ...shared } : x,
            ),
          };
        });
      },
      rollOverTodos(today) {
        const DAY = 86_400_000;
        const due = (t: Todo) =>
          !t.done &&
          t.date !== undefined &&
          t.date < today &&
          t.date >= today - 14 * DAY && // not ancient history
          t.createdAt < t.date + DAY + 6 * 3_600_000; // planned before that day was over (not added after the fact)
        if (!get().todos.some(due)) return;
        set((s) => ({
          todos: s.todos.map((t) =>
            due(t) ? { ...t, missed: [...(t.missed ?? []), t.date!], date: undefined, time: undefined, duration: undefined, run: undefined } : t,
          ),
        }));
      },
      branchTodo(id) {
        const t = get().todos.find((x) => x.id === id);
        if (!t) return null;
        const root = t.branchOf ?? t.id;
        const main = get().todos.find((x) => x.id === root) ?? t;
        const nid = uid();
        const b: Todo = {
          id: nid,
          name: main.name,
          // everything branches share (project and note too — left out before 10/12, the branch fell out of its folder)
          ...(Object.fromEntries([...BRANCH_SHARED].map((k) => [k, main[k as keyof Todo]])) as Partial<Todo>),
          activityId: main.activityId,
          color: main.color,
          date: t.date, // same day as the one it came from; the time is left for you to set
          branchOf: root,
          done: false,
          createdAt: Date.now(),
          order: (t.order ?? t.createdAt) + 0.5,
        };
        set((s) => ({ todos: [...s.todos, b] }));
        return nid;
      },
      moveBranch(id, index) {
        const todos = get().todos;
        const t = todos.find((x) => x.id === id);
        if (!t?.branchOf) return;
        const sibs = todos.filter((x) => x.branchOf === t.branchOf).sort(branchSort);
        const rest = sibs.filter((x) => x.id !== id);
        const at = Math.max(0, Math.min(index, rest.length));
        if (sibs[at]?.id === id) return;
        const next = [...rest.slice(0, at), t, ...rest.slice(at)];
        // the keys the group already uses, handed out again in the new order (kept strictly rising, so
        // equal keys from older branches can't undo the move); each branch's key only matters next to
        // its siblings — it always sits under its main
        const keys = sibs.map(branchKey).sort((a, b) => a - b);
        for (let i = 1; i < keys.length; i++) if (keys[i] <= keys[i - 1]) keys[i] = keys[i - 1] + 0.001;
        const order = new Map(next.map((x, i) => [x.id, keys[i]]));
        set((s) => ({ todos: s.todos.map((x) => (order.has(x.id) && order.get(x.id) !== x.order ? { ...x, order: order.get(x.id) } : x)) }));
      },
      repairBranchShared() {
        const todos = get().todos;
        const byId = new Map(todos.map((t) => [t.id, t]));
        let changed = false;
        const next = todos.map((t) => {
          const main = t.branchOf ? byId.get(t.branchOf) : undefined;
          if (!main) return t;
          const fill: Partial<Todo> = {};
          if (main.campaignId && !t.campaignId) fill.campaignId = main.campaignId;
          if (main.note && !t.note) fill.note = main.note;
          if (!Object.keys(fill).length) return t;
          changed = true;
          return { ...t, ...fill };
        });
        if (changed) set({ todos: next });
      },
      toggleTodo(id) {
        const now = Date.now();
        set((s) => ({
          todos: s.todos.map((t) => {
            if (t.id !== id) return t;
            // done with no date: it takes the (logical) day it was done on; unchecked again, it's undated again
            if (!t.done && t.date === undefined) return { ...t, done: true, doneAt: now, date: logicalDate(now, s.settings.dayStart), datedOnDone: true };
            if (t.done && t.datedOnDone) return { ...t, done: false, doneAt: undefined, date: undefined, datedOnDone: undefined };
            return { ...t, done: !t.done, doneAt: !t.done ? now : undefined };
          }),
        }));
      },
      deleteTodo(id) {
        set((s) => {
          const todos = s.todos.filter((t) => t.id !== id);
          // deleting a main: its first branch becomes the main of the rest
          const heirs = todos.filter((t) => t.branchOf === id).sort((a, b) => a.createdAt - b.createdAt);
          if (heirs.length === 0) return { todos };
          const heir = heirs[0].id;
          return { todos: todos.map((t) => (t.id === heir ? { ...t, branchOf: undefined } : t.branchOf === id ? { ...t, branchOf: heir } : t)) };
        });
      },

      addCampaign(c) {
        const id = uid();
        set((s) => ({ campaigns: [...(s.campaigns ?? []), { ...c, id, createdAt: Date.now() }] }));
        return id;
      },
      updateCampaign(id, patch) {
        set((s) => ({
          campaigns: (s.campaigns ?? []).map((c) =>
            c.id === id ? { ...c, ...patch, ...(patch.done !== undefined && patch.done !== c.done ? { doneAt: patch.done ? Date.now() : undefined } : {}) } : c,
          ),
        }));
      },
      deleteCampaign(id) {
        set((s) => ({
          campaigns: (s.campaigns ?? []).filter((c) => c.id !== id),
          todos: s.todos.map((t) => (t.campaignId === id ? { ...t, campaignId: undefined } : t)),
          tickets: (s.tickets ?? []).map((t) => (t.campaignId === id ? { ...t, campaignId: undefined, updatedAt: Date.now() } : t)),
          artifacts: (s.artifacts ?? []).filter((a) => a.campaignId !== id),
        }));
      },
      addArtifact(campaignId, title = "") {
        const id = uid();
        const now = Date.now();
        set((s) => ({ artifacts: [...(s.artifacts ?? []), { id, campaignId, title, body: null, order: nextOrder(s.artifacts ?? [], campaignId), createdAt: now, updatedAt: now }] }));
        return id;
      },
      updateArtifact(id, patch) {
        // gone (deleted here or elsewhere while its editor was still saving): nothing to write
        if (!(get().artifacts ?? []).some((a) => a.id === id)) return;
        set((s) => ({ artifacts: s.artifacts.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)) }));
      },
      deleteArtifact(id) {
        set((s) => ({ artifacts: (s.artifacts ?? []).filter((a) => a.id !== id) }));
      },
      moveArtifactTo(id, campaignId) {
        const all = get().artifacts ?? [];
        const me = all.find((a) => a.id === id);
        if (!me || me.campaignId === campaignId) return;
        const order = nextOrder(all, campaignId);
        // a move, not an edit (its "updated" time stays); off the old project's canvas spot too
        set((s) => ({
          artifacts: s.artifacts.map((a) => {
            if (a.id !== id) return a;
            const { x: _x, y: _y, ...rest } = a; // eslint-disable-line @typescript-eslint/no-unused-vars
            return { ...rest, campaignId, order };
          }),
        }));
      },
      moveArtifact(id, index) {
        const keys = moveKeys(get().artifacts ?? [], id, index);
        const me = (get().artifacts ?? []).find((a) => a.id === id);
        const placed = me !== undefined && (me.x !== undefined || me.y !== undefined);
        if (!keys.size && !placed) return;
        // the place only: a move isn't an edit of the document (its "updated" time stays)
        set((s) => ({
          artifacts: s.artifacts.map((a) => {
            const r = keys.has(a.id) ? { ...a, order: keys.get(a.id)! } : a;
            if (a.id !== id || !placed) return r;
            const { x: _x, y: _y, ...inLine } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
            return inLine;
          }),
        }));
      },
      placeArtifact(id, at) {
        const x = Math.max(0, Math.round(at.x));
        const y = Math.round(at.y);
        const me = (get().artifacts ?? []).find((a) => a.id === id);
        if (!me || (me.x === x && me.y === y)) return;
        set((s) => ({ artifacts: s.artifacts.map((a) => (a.id === id ? { ...a, x, y } : a)) }));
      },
      addGoal(g) {
        const id = uid();
        set((s) => ({ goals: [...s.goals, { ...g, id, createdAt: Date.now() }] }));
        return id;
      },
      updateGoal(id, patch) {
        set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
      },
      deleteGoal(id) {
        set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
      },

      addActivity(a) {
        const id = uid();
        set((s) => ({
          activities: [
            ...s.activities.filter((x) => x.id !== OTHER_ID),
            { ...a, id, order: s.activities.length - 1 },
            ...s.activities.filter((x) => x.id === OTHER_ID),
          ].map((x, i) => ({ ...x, order: i })),
        }));
        return id;
      },
      updateActivity(id, patch) {
        set((s) => {
          const old = s.activities.find((a) => a.id === id)?.color;
          const activities = s.activities.map((a) => (a.id === id ? { ...a, ...patch } : a));
          const to = patch.color;
          if (!old || !to || old.toLowerCase() === to.toLowerCase()) return { activities };
          // New activity color: records still wearing the old one follow; custom-colored ones keep theirs.
          const follow = <T extends { activityId: string; color: string }>(xs: T[]) =>
            xs.map((x) => (x.activityId === id && x.color.toLowerCase() === old.toLowerCase() ? { ...x, color: to } : x));
          return { activities, plans: follow(s.plans), actuals: follow(s.actuals), todos: follow(s.todos) };
        });
      },
      deleteActivity(id) {
        if (id === OTHER_ID) return;
        // Records keep existing; they fall back to "Other".
        set((s) => ({
          activities: s.activities.filter((a) => a.id !== id),
          plans: s.plans.map((p) => (p.activityId === id ? { ...p, activityId: OTHER_ID } : p)),
          actuals: s.actuals.map((a) => (a.activityId === id ? { ...a, activityId: OTHER_ID } : a)),
          todos: s.todos.map((t) => (t.activityId === id ? { ...t, activityId: OTHER_ID } : t)),
          goals: s.goals.filter((g) => g.activityId !== id),
          campaigns: (s.campaigns ?? []).map((c) => (c.activityIds.includes(id) ? { ...c, activityIds: c.activityIds.filter((x) => x !== id) } : c)),
        }));
      },
      reorderActivities(ids) {
        set((s) => ({
          activities: s.activities
            .map((a) => ({ ...a, order: ids.indexOf(a.id) === -1 ? 999 : ids.indexOf(a.id) }))
            .sort((a, b) => a.order - b.order),
        }));
      },

      startTimer(t) {
        if (get().timer) get().stopTimer();
        set({ timer: { ...t, start: Date.now() } });
      },
      stopTimer(endAt) {
        const t = get().timer;
        if (!t) return null;
        set({ timer: null });
        const end = Math.min(Date.now(), endAt ?? Infinity);
        if (end - t.start < MIN) return null; // too short to record
        // A pomodoro on a picked to-do is recorded against it. It finishes the to-do only when the
        // session ran its full length and the to-do has no planned time (stopping early leaves it
        // open). Anything else unplanned becomes a done to-do in addActual.
        let todoId: string | undefined;
        const picked = t.targetEnd && t.todoId ? get().todos.find((x) => x.id === t.todoId) : undefined;
        if (picked) {
          todoId = picked.id;
          // a to-do with planned time is confirmed from its dashed block (the pomodoro only adds);
          // an unplanned one is finished by a full session
          const planned = picked.date !== undefined && picked.time !== undefined && !!picked.duration;
          if (!picked.done && !planned && end >= t.targetEnd!) get().toggleTodo(picked.id);
        }
        return get().addActual({
          name: t.name,
          activityId: t.activityId,
          color: t.color,
          start: t.start,
          end,
          planKey: t.planKey,
          todoId,
        });
      },
      cancelTimer() {
        set({ timer: null });
      },

      hideEvent(eventId) {
        set((s) => {
          const cur = s.settings.hiddenEventIds ?? [];
          if (cur.includes(eventId)) return {};
          return { settings: { ...s.settings, hiddenEventIds: [...cur, eventId].slice(-500) } };
        });
      },
      skipEvent(eventId) {
        set((s) => {
          const cur = s.settings.skippedEventIds ?? [];
          if (cur.includes(eventId)) return {};
          return { settings: { ...s.settings, skippedEventIds: [...cur, eventId].slice(-500) } };
        });
      },
      setDiary(date, text) {
        const d = new Date(date);
        const id = `diary-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        set((s) => {
          const rest = (s.diary ?? []).filter((x) => x.id !== id);
          if (!text.trim()) return { diary: rest };
          return { diary: [...rest, { id, date: startOfDay(date), text, updatedAt: Date.now() }] };
        });
      },
      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
    }),
    {
      name: "sync-store-v1",
      // no storage during SSR/prerender (Node may expose a non-functional localStorage global)
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? { getItem: () => null, setItem: () => {}, removeItem: () => {} } : window.localStorage,
      ),
      version: 1,
      // Rehydrated from AppShell after mount so the first client render matches the server HTML.
      skipHydration: true,
    },
  ),
);

/** Fields every branch of a to-do shares (the rest — name, date, time, done, order — is per branch). */
const BRANCH_SHARED = new Set(["activityId", "color", "deadline", "campaignId", "note"]);

/**
 * Split a list's to-dos into open and done, keeping branch groups together: a group stays among the
 * open ones (its finished members checked) until all of it is done, and the main shows up wherever an
 * open branch of it is listed (another day too).
 */
/** Missed on a day it hasn't been dragged into No date since (still owed: Carried over). */
export function stillCarried(t: Todo): boolean {
  return !!t.missed?.length && Math.max(...t.missed) > (t.settled ?? -Infinity);
}

export function openAndDone(
  all: Todo[],
  inList: (t: Todo) => boolean,
  today = logicalDate(Date.now(), useSync.getState().settings.dayStart),
): { open: Todo[]; done: Todo[] } {
  // a group (main + branches) stays together until all of it is done: a finished member of a group
  // that still has open work stays in the list (struck) instead of splitting off into Done.
  // A branch finished for a day already past goes to Done anyway, so a long group doesn't pile up.
  const openGroup = new Set(all.filter((t) => !t.done).map((t) => t.branchOf ?? t.id));
  const pastBranch = (t: Todo) => !!t.branchOf && (t.date ?? (t.doneAt !== undefined ? logicalDate(t.doneAt, useSync.getState().settings.dayStart) : today)) < today;
  const open = all.filter((t) => inList(t) && (!t.done || (openGroup.has(t.branchOf ?? t.id) && !pastBranch(t))));
  const ids = new Set(open.map((t) => t.id));
  for (const t of [...open]) {
    if (!t.branchOf || ids.has(t.branchOf)) continue;
    const main = all.find((x) => x.id === t.branchOf);
    if (main) {
      open.push(main); // the main follows its open branch here
      ids.add(main.id);
    }
  }
  const done = all.filter((t) => inList(t) && t.done && !ids.has(t.id));
  return { open, done };
}

const branchKey = (t: Todo) => t.order ?? t.createdAt;
/** Siblings' order: as arranged (moveBranch), else as made. */
export const branchSort = (a: Todo, b: Todo) => branchKey(a) - branchKey(b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** List order with each main's branches right under it (branches whose main isn't listed stay put). */
export function withBranchesUnderMain(list: Todo[]): Todo[] {
  const ids = new Set(list.map((t) => t.id));
  const kids = new Map<string, Todo[]>();
  for (const t of list) if (t.branchOf && ids.has(t.branchOf)) kids.set(t.branchOf, [...(kids.get(t.branchOf) ?? []), t]);
  const out: Todo[] = [];
  for (const t of list) {
    if (t.branchOf && ids.has(t.branchOf)) continue; // placed under its main
    out.push(t);
    out.push(...(kids.get(t.id) ?? []).sort(branchSort));
  }
  return out;
}

/** "(n/m)" for a to-do that has branches: n = its position (main = 1, then the branches' order), m = count. */
export function branchLabel(t: Todo, todos: Todo[]): string {
  const root = t.branchOf ?? t.id;
  const group = todos.filter((x) => x.id === root || x.branchOf === root);
  if (group.length < 2) return "";
  group.sort((a, b) => (a.id === root ? -1 : b.id === root ? 1 : branchSort(a, b)));
  return `(${group.findIndex((x) => x.id === t.id) + 1}/${group.length})`;
}

/** The to-do fields that mirror an actual (date, start time, length, name, activity). */
function todoFieldsOf(a: Actual, activities: Activity[]) {
  const d = new Date(a.start);
  d.setHours(0, 0, 0, 0);
  return {
    name: a.name || activityOf(activities, a.activityId).name,
    activityId: a.activityId,
    color: a.color,
    date: d.getTime(),
    time: Math.round((a.start - d.getTime()) / MIN),
    duration: Math.max(1, Math.round((a.end - a.start) / MIN)),
  };
}

export function activityOf(activities: Activity[], id: string): Activity {
  return activities.find((a) => a.id === id) ?? activities.find((a) => a.id === OTHER_ID) ?? DEFAULT_ACTIVITIES[DEFAULT_ACTIVITIES.length - 1];
}

/** Resolve the effective end-confirmation flag for a plan. */
export function planEndConfirmation(plan: Plan, activities: Activity[], settings: Settings): boolean {
  if (plan.endConfirmation === "on") return true;
  if (plan.endConfirmation === "off") return false;
  const act = activities.find((a) => a.id === plan.activityId);
  return act ? act.endConfirmation : settings.defaultEndConfirmation;
}
