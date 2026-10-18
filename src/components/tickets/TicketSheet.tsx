"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Ticket } from "@/lib/types";
import { useSync } from "@/lib/store";
import { cx } from "../ui";
import { BarsIcon, CalendarIcon, CheckCircleIcon, ClockIcon, DocIcon, HourglassIcon, PaperclipIcon, PenIcon, PersonIcon, StatusIcon, XIcon } from "../icons";
import { DatePicker } from "../DatePicker";
import { OptionMenu, forgetTicketDetail, loadTicketDetail, useTicketMeta } from "./ticket-ui";
import { TicketCopyMenu } from "./ticket-copy";

interface Detail {
  body: string | null;
  updatedAt: string;
  history: { history_id: string; from_name: string | null; to_name: string | null; event_kind: string; changed_at: string }[];
  comments: { comment_id: string; author_name: string | null; author_agent_model?: string | null; body: string; created_at: string }[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (ms: number | null | undefined) => {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
const dayMs = (ymd: string) => new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))).getTime();
const ymdOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A ticket, in a sheet. Edits apply on Save & close. */
export function TicketSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const ticket = useSync((s) => (s.tickets ?? []).find((t) => t.id === id));
  const updateTicket = useSync((s) => s.updateTicket);
  const hideTicket = useSync((s) => s.hideTicket);
  const meta = useTicketMeta();
  const campaigns = useSync((s) => s.campaigns) ?? [];
  // only what's edited here; the rest follows the ticket. A copy taken when the sheet opened went
  // stale: someone moved the ticket to In progress meanwhile, and Save & close wrote Not started back
  const [edits, setEdits] = useState<Partial<Ticket>>({});
  const draft = ticket ? { ...ticket, ...edits } : null;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  const db = ticket?.databaseId;
  const row = ticket?.rowId;
  useEffect(() => {
    if (!db || !row) return;
    let live = true;
    loadTicketDetail(db, row)
      .then((d) => live && setDetail(d as Detail))
      .catch((e: Error) => live && setDetailError(e.message));
    return () => {
      live = false;
    };
  }, [db, row]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // the description as BlockNote blocks: text blocks are edited in place, anything else is kept as is
  const loaded = useMemo(() => docOf(detail?.body ?? null), [detail?.body]);
  const [doc, setDoc] = useState<BnBlock[] | null>(null);
  const blocksDoc = doc ?? loaded;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  if (!ticket || !draft) return null;
  const set = (patch: Partial<Ticket>) => setEdits((e) => ({ ...e, ...patch }));

  /** Save edited description text; returns the row's new updated_at. */
  async function saveBody(): Promise<string> {
    const r = await fetch("/api/connector/tickets/body", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ db, row, base: detail!.updatedAt, body: JSON.stringify(doc) }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    forgetTicketDetail(db!, row!);
    return j.updatedAt as string;
  }
  async function addImages(files: File[]) {
    if (!db || !row || !detail || uploading) return;
    setUploading(true);
    setSaveError(null);
    try {
      // unsaved text goes first, so the upload (which rewrites the body on the connector) builds on it
      const base = doc ? await saveBody() : detail.updatedAt;
      const form = new FormData();
      for (const f of files) form.append("files", f, f.name || "image.png");
      form.append("db", db);
      form.append("row", row);
      form.append("base", base);
      form.append("position", "end");
      const r = await fetch("/api/connector/tickets/body-media", { method: "POST", headers: { "x-sync-upload": "1" }, body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      forgetTicketDetail(db, row);
      setDetail({ ...detail, body: j.body, updatedAt: j.updatedAt });
      setDoc(null);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!draft || !ticket || saving || uploading) return;
    if (doc && db && row && detail) {
      setSaving(true);
      setSaveError(null);
      try {
        await saveBody();
      } catch (e) {
        setSaveError((e as Error).message);
        setSaving(false);
        return; // keep the sheet open with the text
      }
      setSaving(false);
    }
    const patch: Partial<Ticket> = {};
    for (const k of ["title", "status", "priority", "estimate", "due", "note", "campaignId"] as const) if (k in edits && edits[k] !== ticket[k]) (patch as Record<string, unknown>)[k] = edits[k];
    if (patch.status) {
      const o = meta?.options.status.find((x) => x.name === patch.status);
      if (o) Object.assign(patch, { statusGroup: o.group, statusColor: o.color });
    }
    if (Object.keys(patch).length) updateTicket(ticket.id, patch);
    onClose();
  }
  async function copy() {
    const text = [draft!.title, "", ...(ticket!.local ? (draft!.note ?? "").split("\n") : plainLines(blocksDoc))].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  const statusOpts = meta?.options.status ?? [{ name: ticket.status, color: ticket.statusColor ?? null, group: ticket.statusGroup ?? "to_do" }];
  return (
    <div data-ticket-sheet className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="animate-fade flex max-h-[92dvh] w-full max-w-[580px] flex-col overflow-hidden rounded-t-[18px] bg-surface shadow-2xl sm:rounded-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-fg/10 px-6 py-4">
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{draft.title || "Untitled"}</h2>
          <button aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-fg/60 hover:bg-fg/[0.06]">
            <XIcon size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5 flex items-center gap-3">
            <DocIcon size={26} className="shrink-0 text-fg/45" />
            <input
              aria-label="Title"
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold outline-none"
            />
          </div>

          <div className="grid grid-cols-[150px_1fr] items-center gap-x-3 gap-y-3 text-[14.5px]">
            <Field icon={<StatusIcon size={18} />} label="Status">
              <OptionMenu label="Status" value={draft.status} options={statusOpts} onChange={(v) => v && set({ status: v })} />
            </Field>
            <Field icon={<FolderIcon />} label="Project">
              <OptionMenu
                label="Project"
                value={campaigns.find((c) => c.id === draft.campaignId)?.name ?? null}
                options={campaigns.filter((c) => !c.done || c.id === draft.campaignId).map((c) => ({ name: c.name }))}
                onChange={(v) => set({ campaignId: v ? campaigns.find((c) => c.name === v)?.id : undefined })}
                empty="None"
                allowClear
              />
            </Field>
            <Field icon={<PersonIcon size={18} />} label="Assignee">
              <People names={ticket.assignees} />
            </Field>
            <Field icon={<PenIcon size={18} />} label="Author">
              <People names={ticket.author ? [ticket.author] : []} />
            </Field>
            <Field icon={<BarsIcon size={18} />} label="Priority">
              <OptionMenu label="Priority" value={draft.priority} options={(meta?.options.priority ?? []).map((name) => ({ name }))} onChange={(v) => set({ priority: v })} allowClear />
            </Field>
            <Field icon={<HourglassIcon size={18} />} label="Estimate">
              <OptionMenu label="Estimate" value={draft.estimate} options={(meta?.options.estimate ?? []).map((name) => ({ name }))} onChange={(v) => set({ estimate: v })} allowClear />
            </Field>
            <Field icon={<CalendarIcon size={18} />} label="Due">
              <span className="flex items-center gap-2">
                <DatePicker label="Due" value={draft.due ? dayMs(draft.due) : ticket.createdAt} text={draft.due ? draft.due.replaceAll("-", ".") : "Pick a date"} onChange={(d) => set({ due: ymdOf(d) })} />
                {draft.due && (
                  <button onClick={() => set({ due: null })} className="text-[12px] text-fg/45 hover:text-fg/70">
                    Clear
                  </button>
                )}
              </span>
            </Field>
            <Field icon={<PaperclipIcon size={18} />} label="Files">
              {ticket.files?.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {ticket.files.map((f) => (
                    <a
                      key={f.id}
                      href={`/api/connector/tickets/file?db=${encodeURIComponent(db ?? "")}&id=${encodeURIComponent(f.id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-[220px] truncate rounded-[8px] bg-fg/[0.06] px-2 py-1 text-[13px] hover:bg-fg/[0.1]"
                    >
                      {f.name}
                    </a>
                  ))}
                </span>
              ) : (
                <span className="text-fg/35">None</span>
              )}
            </Field>
            <Field icon={<ClockIcon size={18} />} label="Created">
              <span className="tabular text-fg/75">{stamp(ticket.createdAt)}</span>
            </Field>
            <Field icon={<CheckCircleIcon size={18} />} label="Completed">
              <span className="tabular text-fg/75">{stamp(ticket.completedAt)}</span>
            </Field>
          </div>

          <hr className="my-5 border-fg/10" />

          {ticket.local ? (
            <>
              <p className="mb-2 text-[12px] text-fg/45"># {ticket.projectName} is a project of your own: this ticket stays in Sync and isn&apos;t sent anywhere.</p>
              <textarea
                aria-label="Description"
                value={draft.note ?? ""}
                onChange={(e) => set({ note: e.target.value })}
                placeholder="Description"
                rows={6}
                className="w-full resize-y rounded-[10px] bg-fg/[0.04] px-3 py-2 text-[14.5px] leading-relaxed outline-none placeholder:text-fg/30"
              />
            </>
          ) : !row ? (
            <p className="text-[13px] text-fg/50">Being filed on the connected service… the description, history and comments show once it&apos;s there.</p>
          ) : detailError ? (
            <p className="text-[13px] text-danger-soft">{detailError}</p>
          ) : !detail ? (
            <p className="text-[13px] text-fg/45">Loading…</p>
          ) : (
            <>
              <BodyEditor doc={blocksDoc} db={db} onChange={setDoc} onImages={addImages} uploading={uploading} />

              <hr className="my-5 border-fg/10" />
              <h3 className="mb-3 text-[15px] font-semibold">Status history {detail.history.length}</h3>
              <ol className="space-y-3">
                {detail.history.map((h) => (
                  <li key={h.history_id} className="flex gap-3">
                    <span className="mt-[7px] h-[10px] w-[10px] shrink-0 rounded-full bg-fg/30" />
                    <span>
                      <span className="block text-[14px] font-medium">
                        {h.event_kind === "created" ? `Created · ${h.to_name ?? ""}` : `${h.from_name ?? "—"} → ${h.to_name ?? "—"}`}
                      </span>
                      <span className="block text-[13px] text-fg/50">{when(h.changed_at)}</span>
                    </span>
                  </li>
                ))}
              </ol>

              <hr className="my-5 border-fg/10" />
              <Comments db={db!} row={row} initial={detail.comments} />
            </>
          )}
        </div>

        <footer className="flex items-center gap-4 border-t border-fg/10 px-6 py-4">
          <TicketCopyMenu t={ticket} place="above">
            <button onClick={copy} title="Right-click: copy ticket ID · agent work instruction" className="text-[14px] text-fg/65 hover:text-fg">
              {copied ? "Copied" : "Copy"}
            </button>
          </TicketCopyMenu>
          <button
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              hideTicket(ticket.id);
              onClose();
            }}
            title="Removes it in Sync only (it stays on the connected service)"
            className="text-[14px] text-danger-soft"
          >
            {confirmDelete ? "Click again to delete" : "Delete"}
          </button>
          {saveError && <span className="min-w-0 truncate text-[12.5px] text-danger-soft" title={saveError}>{saveError}</span>}
          <button onClick={save} disabled={saving} className="ml-auto shrink-0 rounded-[12px] bg-[#4f5bd5] px-5 py-2.5 text-[14.5px] font-semibold text-white hover:bg-[#4450c6] disabled:opacity-60">
            {saving ? "Saving…" : "Save & close"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <span className="flex items-center gap-2.5 text-fg/60">
        <span className="flex w-[22px] justify-center text-fg/45">{icon}</span>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </>
  );
}

function People({ names }: { names?: string[] }) {
  if (!names?.length) return <span className="text-fg/35">Empty</span>;
  return (
    <span className="flex flex-wrap gap-2">
      {names.map((n, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#f3d9de] text-[11px] text-[#b4475a]">{n.slice(0, 1)}</span>
          {n}
        </span>
      ))}
    </span>
  );
}

function Comments({ db, row, initial }: { db: string; row: string; initial: Detail["comments"] }) {
  const [list, setList] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/connector/tickets/comment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ db, row, body }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setList((l) => [...l, j]);
      forgetTicketDetail(db, row);
      setText("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-ticket-comments>
      <h3 className="mb-3 text-[15px] font-semibold">Comments</h3>
      {list.length === 0 ? (
        <p className="mb-3 text-[14px] text-fg/40">No comments yet.</p>
      ) : (
        <ul className="mb-3 space-y-3">
          {list.map((c) => (
            <li key={c.comment_id}>
              <span className="text-[13px] font-medium">{c.author_name ?? c.author_agent_model ?? "—"}</span>
              <span className="ml-2 text-[12px] text-fg/45">{when(c.created_at)}</span>
              <p className="whitespace-pre-wrap text-[14px]">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="@ to mention · ⌘/Ctrl+Enter to post"
          className="min-h-[56px] flex-1 resize-y rounded-[12px] bg-fg/[0.05] px-3 py-2 text-[14px] outline-none placeholder:text-fg/35"
        />
        <button onClick={send} disabled={!text.trim() || busy} className="h-[42px] rounded-[12px] bg-[#4f5bd5] px-4 text-[14px] font-semibold text-white disabled:opacity-40">
          Post
        </button>
      </div>
      {err && <p className="mt-2 text-[12.5px] text-danger-soft">{err}</p>}
    </div>
  );
}

// ---- description (BlockNote JSON) ----

interface BnBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BnBlock[];
}
const TEXT_TYPES = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote"]);
const newParagraph = (text = ""): BnBlock => ({
  id: Math.random().toString(36).slice(2, 12),
  type: "paragraph",
  props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
  content: text ? [{ type: "text", text, styles: {} }] : [],
  children: [],
});
function docOf(body: string | null): BnBlock[] {
  if (!body) return [];
  try {
    const d = JSON.parse(body);
    if (Array.isArray(d)) return d as BnBlock[];
  } catch {}
  return body.trim() ? body.split("\n").map((l) => newParagraph(l)) : []; // plain text from elsewhere
}
const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content.map((c) => (typeof c?.text === "string" ? c.text : Array.isArray(c?.content) ? textOf(c.content) : "")).join("")
    : "";
function plainLines(doc: BnBlock[]): string[] {
  const out: string[] = [];
  const walk = (bs: BnBlock[] | undefined) =>
    bs?.forEach((b) => {
      const t = textOf(b.content);
      if (t.trim()) out.push(t);
      walk(b.children);
    });
  walk(doc);
  return out;
}
const mediaUrl = (url: string, db: string | undefined) => {
  const media = /\/media\/([A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8})/.exec(url);
  if (media) return `/api/connector/tickets/media?name=${encodeURIComponent(media[1])}`;
  const m = /\/files\/([A-Za-z0-9_-]+)/.exec(url);
  if (m && db) return `/api/connector/tickets/file?db=${encodeURIComponent(db)}&id=${encodeURIComponent(m[1])}`;
  return /^https:\/\//.test(url) ? url : undefined;
};

/**
 * The description, editable: each text block is a text box (a changed one is rewritten as plain text;
 * untouched ones keep their formatting), images and other blocks stay exactly as they are.
 */
function BodyEditor({
  doc,
  db,
  onChange,
  onImages,
  uploading,
}: {
  doc: BnBlock[];
  db: string | undefined;
  onChange: (d: BnBlock[]) => void;
  /** add images (picked or pasted) to the end of the description */
  onImages: (files: File[]) => void;
  uploading: boolean;
}) {
  // an empty description is already a text box with the cursor in it (no "+ Write a description" click first);
  // the same block (same id, same box) carries on once something is typed
  const [blank] = useState(() => newParagraph());
  const empty = doc.length === 0;
  const blocks = empty ? [blank] : doc;
  const update = (path: number[], next: BnBlock | null) => {
    const rec = (list: BnBlock[], depth: number): BnBlock[] => {
      const i = path[depth];
      if (depth === path.length - 1) return next ? list.map((b, k) => (k === i ? next : b)) : list.filter((_, k) => k !== i);
      return list.map((b, k) => (k === i ? { ...b, children: rec(b.children ?? [], depth + 1) } : b));
    };
    onChange(rec(blocks, 0));
  };
  const render = (list: BnBlock[], path: number[]) =>
    list.map((b, i) => {
      const p = [...path, i];
      const key = b.id ?? p.join(".");
      let el: ReactNode;
      if (TEXT_TYPES.has(b.type)) {
        el = (
          <div className="flex items-start gap-1.5">
            {b.type === "bulletListItem" && <span className="pt-[3px] text-fg/50">•</span>}
            {b.type === "numberedListItem" && <span className="pt-[3px] text-fg/50 tabular">{i + 1}.</span>}
            {b.type === "checkListItem" && <span className="pt-[3px] text-fg/50">{b.props?.checked ? "☑" : "☐"}</span>}
            <AutoText
              focusOnMount={empty && b === blank}
              value={textOf(b.content)}
              heading={b.type === "heading"}
              onChange={(v) => update(p, { ...b, content: v ? [{ type: "text", text: v, styles: {} }] : [] })}
              onRemove={() => update(p, null)}
            />
          </div>
        );
      } else if (b.type === "image" && typeof b.props?.url === "string" && mediaUrl(b.props.url, db)) {
        el = (
          <div className="group relative inline-block max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(b.props.url, db)} decoding="async" alt={String(b.props.caption ?? "")} className="max-h-[420px] max-w-full rounded-[10px] border border-fg/10" />
            <button
              aria-label="Remove image"
              onClick={() => update(p, null)}
              className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full bg-black/55 text-[13px] text-white group-hover:flex"
            >
              ✕
            </button>
          </div>
        );
      } else {
        el = <p className="rounded-[8px] bg-fg/[0.04] px-2 py-1 text-[12.5px] text-fg/45">{b.type} — edit it on the connected service</p>;
      }
      return (
        <div key={key}>
          {el}
          {!!b.children?.length && <div className="ml-5 mt-1 space-y-1">{render(b.children, p)}</div>}
        </div>
      );
    });
  return (
    <div
      data-ticket-body
      className="space-y-1 text-[15px] leading-relaxed"
      onPaste={(e) => {
        const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) return;
        e.preventDefault();
        onImages(imgs);
      }}
    >
      {render(blocks, [])}
      <div className="mt-1 flex items-center gap-4 text-[13px] text-fg/40">
        {!empty && (
          <button onClick={() => onChange([...doc, newParagraph()])} className="hover:text-fg/70">
            + Paragraph
          </button>
        )}
        <label className={cx("cursor-pointer hover:text-fg/70", uploading && "pointer-events-none opacity-60")}>
          {uploading ? "Uploading images…" : "+ Image"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const fs = [...(e.target.files ?? [])];
              e.target.value = "";
              if (fs.length) onImages(fs);
            }}
          />
        </label>
      </div>
    </div>
  );
}

/** A text box that grows with its text (a block of the description). Backspace in an empty one removes it. */
function AutoText({
  value,
  heading,
  focusOnMount,
  onChange,
  onRemove,
}: {
  value: string;
  heading?: boolean;
  /** take the cursor when it appears, unless something else is being typed in */
  focusOnMount?: boolean;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusOnMount) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    box.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      aria-label="Description"
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Backspace" && !value) {
          e.preventDefault();
          onRemove();
        }
      }}
      ref={(el) => {
        box.current = el;
        if (!el) return;
        el.style.height = "0px";
        el.style.height = `${el.scrollHeight}px`;
      }}
      placeholder="Write something"
      className={cx("min-w-0 flex-1 resize-none overflow-hidden rounded-[6px] bg-transparent px-1 py-0.5 outline-none placeholder:text-fg/30 focus:bg-fg/[0.04]", heading && "font-semibold")}
    />
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.6h6a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
