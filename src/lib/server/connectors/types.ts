// The contract between Ote and an outside service ("connector"): a task board, a ticket tracker,
// a team calendar and/or a sign-in provider. Ote works fully on its own; a connector only mirrors
// what it supports. Register yours in ./index.ts — see ./README.md.
import type { CalendarEvent, CalendarInfo, TicketGroup, TicketMeta } from "../../types";
import type { Range } from "../ics";

// ---- connection (what Settings asks for, stored encrypted in .data/integrations.json) ----

export interface ConnectorField {
  key: string;
  label: string;
  /** Shown as a password field; never sent back to the browser. */
  secret?: boolean;
  placeholder?: string;
  /** Pre-filled value (e.g. from an environment variable). */
  default?: string;
}

export interface ConnectorConnection {
  connector: string;
  /** Who this connection acts as on the other side (shown in Settings). */
  account: { id: string; label: string };
  config: Record<string, string>;
  connectedAt: number;
}

export interface ConnectorDef {
  id: string;
  label: string;
  /** One or two lines shown above the connect form. */
  description?: string;
  fields: ConnectorField[];
  /** Check the settings (e.g. call a "who am I" endpoint) and return who they act as. Throw to refuse. */
  connect(config: Record<string, string>): Promise<{ account: { id: string; label: string }; config?: Record<string, string> }>;
  /** Called when the user disconnects (e.g. revoke a token). Failures are ignored. */
  disconnect?(conn: ConnectorConnection): Promise<void>;
  open(conn: ConnectorConnection): Connector;
}

export interface Connector {
  tasks?: TaskSource;
  tickets?: TicketSource;
  calendar?: CalendarSource;
}

// ---- tasks: a board of to-dos; ones with a start AND end time show as Plans ----

/** Dates and times are wall-clock strings in the source's `timeZone`. */
export interface RemoteTask {
  /** Shared with Ote: a task made in Ote is created with Ote's id (a UUID). */
  id: string;
  title: string;
  done: boolean;
  /** YYYY-MM-DD, or null for an undated task. */
  date: string | null;
  /** HH:MM */
  time: string | null;
  /** HH:MM — with `time`, the task is a Plan in Ote. */
  endTime: string | null;
  /** YYYY-MM-DD */
  due: string | null;
  /** The source's project, mapped to a Ote activity by .data/task-projects.json (optional). */
  projectId?: string | null;
}

export interface TaskSource {
  /** Zone of the wall times above (e.g. "Europe/Berlin"). */
  timeZone: string;
  /** Rate limit: at most this many writes per run (default 40). */
  maxWritesPerRun?: number;
  /**
   * Open and done tasks, plus the ids of archived / deleted ones (a task gone from both means
   * "deleted there"). `complete: false` when the list may be cut off, so nothing is taken as deleted.
   */
  list(): Promise<{ tasks: RemoteTask[]; archivedIds: string[]; complete: boolean }>;
  create(task: RemoteTask): Promise<void>;
  /** Only the fields given change. `archived: false` brings back an archived task. */
  update(id: string, patch: Partial<Omit<RemoteTask, "id">> & { archived?: boolean }): Promise<void>;
  /** Deleted in Ote. Archive or delete it there. */
  remove(id: string): Promise<void>;
  /** Ids the source can't take as its own (default: any). */
  acceptsId?(id: string): boolean;
  /**
   * Whether the source moves open past tasks to today on its own ("rollover"). Ote then ignores a
   * past plan moved to today with the same times: a plan is a time that's gone, not unfinished work.
   */
  rollsOver?: boolean;
}

// ---- tickets: issues in projects, assigned to the signed-in person ----

/** The fields both sides edit. */
export interface TicketNorm {
  title: string;
  /** Status name, one of `TicketMeta.options.status`. */
  status: string;
  priority: string | null;
  estimate: string | null;
  /** YYYY-MM-DD */
  due: string | null;
}

export interface RemoteTicket extends TicketNorm {
  id: string;
  /** Whatever else the source needs to address it (a board / repository id); opaque to Ote. */
  containerId?: string;
  projectId: string;
  statusGroup: TicketGroup;
  statusColor?: string | null;
  assignees?: string[];
  author?: string | null;
  createdAt?: number | null;
  completedAt?: number | null;
  /** When it last changed there (ms), if known. */
  updatedAt?: number | null;
  files?: { id: string; name: string; type?: string; url?: string }[];
}

/** A ticket's place on the source, as the ticket sheet sends it back. */
export interface TicketRef {
  containerId: string;
  id: string;
}

export interface TicketHistoryItem {
  history_id: string;
  from_name: string | null;
  to_name: string | null;
  to_group?: string | null;
  changed_by?: string | null;
  event_kind: string;
  changed_at: string;
}
export interface TicketComment {
  comment_id: string;
  author_name: string | null;
  author_agent_model?: string | null;
  body: string;
  created_at: string;
}

/** Thrown when the source refuses a write because the ticket changed there since it was read. */
export class StaleError extends Error {}

export interface TicketSource {
  maxWritesPerRun?: number;
  /** Projects tickets can be filed on, and the status / priority / estimate options. */
  meta(): Promise<TicketMeta>;
  /** Tickets assigned to the signed-in person. `complete: false` if some couldn't be read. */
  listMine(): Promise<{ tickets: RemoteTicket[]; complete: boolean }>;
  /** File a ticket made in Ote, assigned to the signed-in person. */
  create(projectId: string, n: TicketNorm): Promise<RemoteTicket>;
  /** Write Ote's values. Throw StaleError if it changed there meanwhile (retried next run). */
  update(t: RemoteTicket, n: TicketNorm): Promise<RemoteTicket>;

  // The ticket sheet (all optional). Descriptions are BlockNote JSON documents; `base` is the
  // `updatedAt` read with the description, so a write over someone else's edit is refused (StaleError).
  detail?(ref: TicketRef): Promise<{ body: string | null; updatedAt: string; history: TicketHistoryItem[]; comments: TicketComment[] }>;
  saveBody?(ref: TicketRef, body: string, base: string): Promise<{ updatedAt: string }>;
  addBodyImages?(ref: TicketRef, files: File[], base: string, position: "start" | "end"): Promise<{ body: string | null; updatedAt: string }>;
  addComment?(ref: TicketRef, body: string): Promise<TicketComment>;
  /** An attachment (`fileId` from RemoteTicket.files) or an image in a description (`name`). */
  file?(containerId: string, fileId: string): Promise<Response>;
  media?(name: string): Promise<Response>;
}

// ---- calendar: read-only event sources ----

export interface CalendarSource {
  /** Calendar ids should start with `connector:<account id>:`; provider is "connector". */
  calendars(): Promise<CalendarInfo[]>;
  events(range: Range, tz?: string): Promise<CalendarEvent[]>;
}

// ---- sign-in: a device-code login (optional; the built-in password login always works) ----

export interface LoginProvider {
  label: string;
  start(): Promise<{ deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }>;
  /** `ok` once approved: who signed in. Ote checks them against OTE_ALLOWED_USERS. */
  poll(deviceCode: string): Promise<{ status: "pending" } | { status: "expired" } | { status: "ok"; userId: string; email: string | null }>;
}
