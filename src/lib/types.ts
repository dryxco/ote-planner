// Core domain model. All timestamps are epoch milliseconds (local time semantics).

export type Repeat = "never" | "daily" | "weekdays" | "weekly" | "monthly";
export type ReminderOption = "activity" | "none" | "atStart" | "5m" | "10m" | "30m" | "1h";
export type EndConfirmOption = "activity" | "on" | "off";

export interface Activity {
  id: string;
  name: string;
  color: string;
  order: number;
  reminder: Exclude<ReminderOption, "activity">;
  endConfirmation: boolean;
  archived?: boolean;
}

/**
 * Pausing something in progress: the part done so far is recorded as an actual, and the rest of its
 * planned time stays tentative from `from` (the pause, then the resume). `done` once confirmed.
 */
export interface Run {
  from: number;
  /** tentative end, when moved without confirming (defaults to the planned end) */
  end?: number;
  paused: boolean;
  done?: boolean;
}

export interface Plan {
  id: string;
  name: string;
  activityId: string;
  color: string;
  place?: string;
  allDay: boolean;
  start: number;
  end: number;
  repeat: Repeat;
  reminder: ReminderOption;
  endConfirmation: EndConfirmOption;
  /** Calendar event this plan was created from (hides the ghost event). */
  sourceEventId?: string;
  /** Saved to a real calendar (this Mac's Calendar: iCloud, Google, …). The server creates the
   *  event, keeps it in step with the plan and deletes it with the plan. `calendarId` is a
   *  CalendarInfo id (`mac:local:…`); `eventId` is filled in once the event exists. */
  calendar?: { calendarId: string; eventId?: string };
  /** Paused / resumed occurrences, by occurrence start (ms, as a string key). */
  runs?: Record<string, Run>;
  /** Occurrence starts (ms) the user skipped or deleted from a repeating series. */
  exceptions?: number[];
  /** Occurrence starts the user confirmed as "not done" via end confirmation. */
  dismissed?: number[];
  createdAt: number;
}

/** One concrete occurrence of a (possibly repeating) plan. */
export interface PlanOccurrence {
  plan: Plan;
  start: number;
  end: number;
  key: string; // `${plan.id}@${start}`
}

export interface Actual {
  id: string;
  name: string;
  activityId: string;
  color: string;
  start: number;
  end: number;
  /** Plan occurrence this actual fulfils ("Record from a plan", confirmations, Start now). */
  planKey?: string;
  sourceEventId?: string;
  /** Paused mid-way: the rest of it, tentative (dashed) until resumed / confirmed. */
  rest?: { from: number; end: number; paused: boolean };
  /** Pomodoro session: the (done) to-do it went into — renaming the actual renames it too. */
  todoId?: string;
  createdAt: number;
}

export interface Todo {
  id: string;
  /** The ticket this to-do carries on the timeline (dragged from the ticket board). */
  ticketId?: string;
  name: string;
  activityId: string;
  color: string;
  /** Day (ms at local midnight). Undefined = no date (lives in the To-dos cell). */
  date?: number;
  /** Minutes after midnight. */
  time?: number;
  /** With a time: how long it takes, in minutes — drawn as a block like a plan, but it stays a to-do. */
  duration?: number;
  deadline?: number;
  /** Days it was planned for but not done (it rolled over to No date): shown struck on those days. */
  missed?: number[];
  /** Dragged into No date by hand: missed days up to this one no longer put it under Carried over. */
  settled?: number;
  /** Paused / resumed while doing it (its remaining planned time starts at `run.from`). */
  run?: Run;
  /** Branch of another to-do (its "main"): same details, its own date/time/done. */
  branchOf?: string;
  /** Made automatically for an unplanned actual (follows it, and goes when it's deleted). */
  fromActual?: string;
  /** Manual position in task lists (sorts by `order ?? createdAt`). */
  order?: number;
  /** Attached to a plan: due before it. */
  planId?: string;
  /** The project (campaign) it belongs to. */
  campaignId?: string;
  note?: string;
  done: boolean;
  doneAt?: number;
  /** It had no date and got the day it was done on (undoing that check makes it undated again). */
  datedOnDone?: boolean;
  createdAt: number;
}

/**
 * A project: a campaign of tasks and tickets toward one end, often with a due date ("Ship the beta",
 * due 10/15). Linked to activities (its time is counted from their actuals between start and
 * due) and to "#" projects (where its tickets usually go). Items join it by their `campaignId`.
 */
export interface Campaign {
  id: string;
  name: string;
  /** Local midnight of the first / last day (optional). */
  start?: number;
  due?: number;
  activityIds: string[];
  /** "#" project ids (the connector's or Ote-only). */
  tags: string[];
  note?: string;
  done?: boolean;
  doneAt?: number;
  order?: number;
  createdAt: number;
}

/**
 * A document linked to a project (a page like a Slack canvas / Notion page). The body is the editor's
 * document as JSON (ProseMirror / TipTap); images in it point at /api/artifacts/media, never data: URLs.
 */
export interface Artifact {
  id: string;
  /** The project (Campaign) it belongs to. */
  campaignId: string;
  title: string;
  body: ArtifactDoc | null;
  /** Place among its project's artifacts (smaller first). */
  order: number;
  /** How far right of its column its node sits on the canvas (px); missing = in line. */
  x?: number;
  /** Placed freely (dragged there): how far below its project card's top its node sits (px). Missing = in its project's line. */
  y?: number;
  createdAt: number;
  updatedAt: number;
}

/** A node of an artifact's document (ProseMirror JSON). */
export interface ArtifactDoc {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ArtifactDoc[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/** A short day note (one per calendar date; id = `diary-YYYY-MM-DD` so devices agree). */
export interface DiaryEntry {
  id: string;
  /** Local midnight of the day. */
  date: number;
  text: string;
  updatedAt: number;
}

export type GoalPeriod = "week" | "month" | "year";

export interface Goal {
  id: string;
  period: GoalPeriod;
  /** Start of the period (ms) the goal belongs to. */
  periodStart: number;
  /** time / count: totals over the period. daily: at least `target` records each day.
   *  onTime: each day with a plan of the activity, its first actual starts no later than the first plan. */
  kind: "time" | "count" | "daily" | "onTime";
  activityId: string;
  /** minutes for time goals, count for count and daily goals (unused for onTime) */
  target: number;
  createdAt: number;
}

export interface Timer {
  activityId: string;
  name: string;
  color: string;
  start: number;
  planKey?: string;
  /** Pomodoro: the timer stops itself here (and records the actual up to this moment). */
  targetEnd?: number;
  /** To-do this focus session is for (pomodoro). */
  todoId?: string;
}

export interface Settings {
  /** Minutes after midnight the logical day begins (default 05:00). */
  dayStart: number;
  /** Minutes after midnight the logical day closes, next calendar day (default 01:00). */
  dayClose: number;
  weekStartsOn: 0 | 1 | 6;
  defaultReminder: Exclude<ReminderOption, "activity">;
  defaultEndConfirmation: boolean;
  showCalendarEvents: boolean;
  hiddenCalendarIds: string[];
  /** Single calendar events hidden from the timeline (e.g. after deleting the plan made from one). */
  hiddenEventIds?: string[];
  /** Calendar events that didn't happen: still on the Plan side, gone from Actual. */
  skippedEventIds?: string[];
  /** "#" projects made in Ote for my own tickets — never sent to a connector. Ids start with `local:`. */
  localProjects?: { id: string; name: string; color?: string | null }[];
}

// ---- Calendar integration contract (client <-> /api/calendar/*) ----

export type CalendarProvider = "google" | "apple" | "ics" | "connector" | "mac";

export const PROVIDER_LABEL: Record<CalendarProvider, string> = { google: "Google", apple: "iCloud", ics: "iCal", connector: "Connector", mac: "Mac" };

export interface CalendarInfo {
  /** Globally unique: `${provider}:${accountId}:${calendarId}` */
  id: string;
  provider: CalendarProvider;
  accountId: string;
  name: string;
  color: string;
  /** Ote can add events to it (this Mac's calendars that allow changes). */
  writable?: boolean;
}

export interface CalendarAccount {
  provider: CalendarProvider;
  accountId: string;
  label: string; // e.g. email / Apple ID
}

export interface CalendarEvent {
  /** Globally unique: `${calendarInfo.id}:${eventId}:${occurrenceStart}` */
  id: string;
  calendarId: string;
  provider: CalendarProvider;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  notes?: string;
  color: string;
  /** The iCalendar UID (ICS / iCloud), to recognize an event Ote wrote arriving through another source. */
  uid?: string;
  /** Ids of the same event in other connected calendars, shown once as this one (client-side). */
  twins?: string[];
}

/** GET /api/calendar/calendars */
export interface CalendarsResponse {
  accounts: CalendarAccount[];
  calendars: CalendarInfo[];
  errors?: { provider: CalendarProvider; accountId?: string; message: string }[];
  /** Server has a Google OAuth client configured (otherwise connect Google via its iCal link). */
  googleOAuth?: boolean;
}

/** GET /api/calendar/events?start=<ms>&end=<ms> */
export interface EventsResponse {
  events: CalendarEvent[];
  errors?: { provider: CalendarProvider; accountId?: string; message: string }[];
}

/** Status group of a ticket. */
export type TicketGroup = "to_do" | "in_progress" | "complete" | "backlog";

/**
 * A ticket: in a project of your own, or one assigned to you on the connected service (mirrored both ways).
 * Fields the board owns but Ote only shows (assignees, author, dates, files) are refreshed by the
 * server; title / status / priority / estimate / due are edited in either place.
 */
export interface Ticket {
  id: string;
  /** The connector's id; unset for a ticket made in Ote until the server has filed it. */
  rowId?: string;
  /** The connector's container (board / repository) id. */
  databaseId?: string;
  projectId: string;
  projectName?: string;
  title: string;
  /** Status option name (one of TicketMeta.options.status). */
  status: string;
  statusGroup?: TicketGroup;
  statusColor?: string | null;
  priority?: string | null;
  estimate?: string | null;
  /** YYYY-MM-DD */
  due?: string | null;
  assignees?: string[];
  author?: string | null;
  createdAt: number;
  completedAt?: number | null;
  /** When it got its current status (backlog / done list under the day it happened). */
  statusSince?: number | null;
  files?: { id: string; name: string; type?: string; url?: string }[];
  /** Removed in Ote: hidden here, kept on the connected service. */
  hidden?: boolean;
  /** In a Ote-only project (`Settings.localProjects`): stays in Ote, never filed on a connector. */
  local?: boolean;
  /** A Ote-only ticket's description (a connector's tickets keep theirs there). */
  note?: string;
  /** The project (campaign) it belongs to — kept in Ote only, never sent to a connector. */
  campaignId?: string;
  /** A sub-item of this task (dropped onto it in a project folder) — kept in Ote only, never sent to a connector. */
  parentTodoId?: string;
  order?: number;
  updatedAt?: number;
}

/** GET /api/connector/tickets/meta */
export interface TicketMeta {
  /** `noBoard`: a parent shown only as the heading of its sub-projects (tickets can't go there). */
  projects: { id: string; name: string; parentId: string | null; color: string | null; noBoard?: boolean; local?: boolean }[];
  /** Option names (in board order) per field, from the boards the tickets live on. */
  options: { status: { name: string; group: TicketGroup; color: string | null }[]; priority: string[]; estimate: string[] };
}
