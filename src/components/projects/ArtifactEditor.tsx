"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import type { ArtifactDoc } from "@/lib/types";
import { useSync } from "@/lib/store";
import { docImages, docText, withoutInlineImages } from "@/lib/artifacts";
import { XIcon } from "../icons";
import { cx } from "../ui";

/** Typing pauses this long before the document is written to the store (and synced). */
const SAVE_MS = 700;

async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/artifacts/media", { method: "POST", headers: { "x-sync-upload": "1" }, body: form });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.url;
}

const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

/** "example.com" -> "https://example.com"; schemes other than web / mail links aren't kept. */
function normalizeHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^(https?:|mailto:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  return `https://${v.replace(/^\/+/, "")}`;
}

/**
 * The document editor for one artifact: a full-height panel (the whole screen on phones). Headings,
 * lists (nested), checklists, links, inline marks, quotes, dividers and images; markdown shortcuts
 * work as you type (# , - , 1. , [ ] , > , ---). Writes go through the store after a short pause, so
 * the document syncs like any other record.
 */
export function ArtifactEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useSync((s) => (s.artifacts ?? []).find((x) => x.id === id));
  const project = useSync((s) => (s.campaigns ?? []).find((c) => c.id === a?.campaignId)?.name);
  const { updateArtifact, deleteArtifact } = useSync.getState();
  // the body this editor last loaded or wrote (a store change that differs came from elsewhere)
  const saved = useRef<ArtifactDoc | null>(a?.body ?? null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edRef = useRef<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const ed = edRef.current;
    if (!ed || !dirty.current) return;
    dirty.current = false;
    const body = withoutInlineImages(ed.getJSON() as ArtifactDoc);
    saved.current = body;
    updateArtifact(id, { body });
    setSaving(false);
  };
  const flushRef = useRef(flush);

  const insertImages = async (files: File[], pos?: number) => {
    setError(null);
    setUploading((n) => n + files.length);
    for (const f of files) {
      try {
        const src = await uploadImage(f);
        const ed = edRef.current;
        if (!ed || ed.isDestroyed) return;
        if (pos !== undefined) ed.chain().insertContentAt(pos, { type: "image", attrs: { src, alt: f.name || null } }).run();
        else ed.chain().focus().setImage({ src, alt: f.name || undefined }).run();
      } catch (e) {
        setError(`Couldn't add ${f.name || "the image"}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const insertRef = useRef(insertImages);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // data: images are never read in (a paste can carry them): pasted image files are uploaded instead
      Image.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder: "Write here — # heading, - list, [ ] checklist, > quote" }),
    ],
    content: a?.body ?? "",
    editorProps: {
      attributes: { class: "artifact-doc", "aria-label": "Document" },
      handlePaste: (_view, e) => {
        const files = imageFiles(e.clipboardData?.files);
        if (!files.length) return false;
        e.preventDefault();
        void insertRef.current(files);
        return true;
      },
      handleDrop: (view, e, _slice, moved) => {
        const files = moved ? [] : imageFiles(e.dataTransfer?.files);
        if (!files.length) return false;
        e.preventDefault();
        void insertRef.current(files, view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos);
        return true;
      },
      // links open with ⌘ / Ctrl + click (a plain click edits)
      handleClick: (_view, _pos, e) => {
        const el = (e.target as HTMLElement).closest("a");
        if (!el || !(e.metaKey || e.ctrlKey)) return false;
        window.open(el.href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
    onCreate: ({ editor }) => {
      edRef.current = editor;
    },
    onUpdate: () => {
      dirty.current = true;
      setSaving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flushRef.current(), SAVE_MS);
    },
  });

  // an edit from another device (or an undo) while open: show it, unless typing here hasn't been saved yet
  const body = a?.body ?? null;
  useEffect(() => {
    if (!editor || dirty.current || body === saved.current) return;
    if (JSON.stringify(body) === JSON.stringify(saved.current)) {
      saved.current = body; // the server's echo of what this editor wrote
      return;
    }
    saved.current = body;
    editor.commands.setContent(body ?? "", { emitUpdate: false });
  }, [editor, body]);

  // write what's pending when the panel goes (closed, or the artifact was deleted elsewhere)
  useEffect(() => () => flushRef.current(), []);
  const gone = !a;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  const close = () => {
    flush();
    // an artifact opened and left untouched (no title, no text, no image) doesn't stay behind
    const cur = useSync.getState().artifacts.find((x) => x.id === id);
    if (cur && !cur.title.trim() && !docText(cur.body) && !docImages(cur.body).length) deleteArtifact(id);
    onClose();
  };
  const openLink = () => {
    if (!editor) return;
    setLink((editor.getAttributes("link").href as string | undefined) ?? "");
  };
  // the latest closures for listeners set up once (the editor's handlers, the keys below)
  const closeRef = useRef(close);
  const linkRef = useRef(openLink);
  useEffect(() => {
    flushRef.current = flush;
    insertRef.current = insertImages;
    closeRef.current = close;
    linkRef.current = openLink;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") closeRef.current();
      else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault(); // it saves by itself; ⌘S just doesn't wait
        flushRef.current();
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        linkRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const applyLink = (raw: string) => {
    if (!editor) return;
    const href = normalizeHref(raw);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: raw.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    setLink(null);
  };

  if (!a) return null;
  const status = uploading ? "Uploading image…" : saving ? "Saving…" : "Saved";

  return (
    <div data-artifact-editor={id} className="fixed inset-0 z-50 flex justify-end">
      <div className="animate-fade absolute inset-0 bg-black/45" onClick={close} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={a.title || "Untitled"}
        className="animate-panel relative flex h-full w-full flex-col bg-surface-0 pt-[env(safe-area-inset-top)] shadow-2xl lg:w-[min(880px,calc(100vw_-_140px))] lg:border-l lg:border-fg/10"
      >
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-fg/[0.07] px-3">
          <button aria-label="Close" onClick={close} className="flex h-[32px] w-[32px] items-center justify-center rounded-full text-fg/60 hover:bg-fg/[0.08] hover:text-fg">
            <XIcon size={16} />
          </button>
          <span className="min-w-0 truncate text-[12.5px] text-fg/50">{project ?? "Project"}</span>
          <span data-artifact-status className={cx("ml-auto shrink-0 text-[12px] tabular", error ? "text-danger-soft" : "text-fg/40")}>
            {error ?? status}
          </span>
          {armed ? (
            <button
              data-delete-artifact-confirm
              onClick={() => {
                deleteArtifact(id);
                onClose();
              }}
              className="h-[28px] shrink-0 rounded-full bg-[#ff453a] px-3 text-[12.5px] font-semibold text-white"
            >
              Delete artifact
            </button>
          ) : (
            <button data-delete-artifact onClick={() => setArmed(true)} className="shrink-0 rounded-full px-2.5 py-1 text-[12.5px] text-fg/50 hover:bg-fg/[0.08] hover:text-danger-soft">
              Delete
            </button>
          )}
        </header>
        {editor && <Toolbar editor={editor} onLink={openLink} onImage={() => fileRef.current?.click()} />}
        {link !== null && <LinkBar initial={link} onApply={applyLink} onCancel={() => setLink(null)} />}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          multiple
          hidden
          data-artifact-file
          onChange={(e) => {
            const files = imageFiles(e.currentTarget.files);
            e.currentTarget.value = "";
            if (files.length) void insertImages(files);
          }}
        />
        <div className="min-h-0 flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
          <div className="mx-auto max-w-[720px] px-5 pb-[40vh] pt-8 lg:px-10">
            <TitleField
              value={a.title}
              onChange={(title) => updateArtifact(id, { title })}
              onEnter={() => {
                if (!editor) return;
                editor.view.focus(); // now: the command's own focus waits a frame, and what's typed meanwhile went to the title
                editor.commands.focus("start");
              }}
              autoFocus={!a.title && !a.body}
            />
            <EditorContent editor={editor} />
          </div>
        </div>
      </section>
    </div>
  );
}

/** The document's title: grows to fit; Enter moves into the body. */
function TitleField({ value, onChange, onEnter, autoFocus }: { value: string; onChange: (v: string) => void; onEnter: () => void; autoFocus: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      data-artifact-title
      aria-label="Title"
      rows={1}
      autoFocus={autoFocus}
      value={value}
      placeholder="Untitled"
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
      }}
      className="mb-3 block w-full resize-none overflow-hidden bg-transparent text-[30px] font-bold leading-[1.25] tracking-[-0.01em] outline-none placeholder:text-fg/25"
    />
  );
}

function Toolbar({ editor, onLink, onImage }: { editor: Editor; onLink: () => void; onImage: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div data-artifact-toolbar role="toolbar" aria-label="Formatting" className="no-scrollbar flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-fg/[0.07] px-2 py-1.5 lg:justify-center">
      <Tool label="Heading 1" on={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}>
        <b className="text-[13px]">H1</b>
      </Tool>
      <Tool label="Heading 2" on={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}>
        <b className="text-[13px]">H2</b>
      </Tool>
      <Tool label="Heading 3" on={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>
        <b className="text-[13px]">H3</b>
      </Tool>
      <Sep />
      <Tool label="Bold" keys="⌘B" on={s.bold} onClick={() => c().toggleBold().run()}>
        <b className="text-[15px]">B</b>
      </Tool>
      <Tool label="Italic" keys="⌘I" on={s.italic} onClick={() => c().toggleItalic().run()}>
        <i className="font-serif text-[16px]">I</i>
      </Tool>
      <Tool label="Strikethrough" keys="⌘⇧S" on={s.strike} onClick={() => c().toggleStrike().run()}>
        <s className="text-[15px]">S</s>
      </Tool>
      <Tool label="Inline code" keys="⌘E" on={s.code} onClick={() => c().toggleCode().run()}>
        <span className="font-mono text-[12.5px]">{"</>"}</span>
      </Tool>
      <Tool label="Link" keys="⌘K" on={s.link} onClick={onLink}>
        <Glyph d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </Tool>
      <Sep />
      <Tool label="Bulleted list" on={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <Glyph d="M9 7h11M9 12h11M9 17h11" dots />
      </Tool>
      <Tool label="Numbered list" on={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
          <path d="M10 7h10M10 12h10M10 17h10" />
          <text x="2.5" y="9" fontSize="6.5" fill="currentColor" stroke="none" fontWeight="600">1</text>
          <text x="2.5" y="14" fontSize="6.5" fill="currentColor" stroke="none" fontWeight="600">2</text>
          <text x="2.5" y="19" fontSize="6.5" fill="currentColor" stroke="none" fontWeight="600">3</text>
        </svg>
      </Tool>
      <Tool label="Checklist" on={s.task} onClick={() => c().toggleTaskList().run()}>
        <Glyph d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M11 7h9M11 13h9M4.5 18h3v0M11 19h9" />
      </Tool>
      <Sep />
      <Tool label="Quote" on={s.quote} onClick={() => c().toggleBlockquote().run()}>
        <Glyph d="M5 6v12M9 8h10M9 12h10M9 16h6" />
      </Tool>
      <Tool label="Divider" onClick={() => c().setHorizontalRule().run()}>
        <Glyph d="M4 12h16" />
      </Tool>
      <Tool label="Image" onClick={onImage}>
        <Glyph d="M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17.5M15.5 9.5h.01" />
      </Tool>
    </div>
  );
}

function Tool({ label, keys, on, onClick, children }: { label: string; keys?: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={keys ? `${label} (${keys})` : label}
      onMouseDown={(e) => e.preventDefault()} // keep the editor's selection
      onClick={onClick}
      className={cx("flex h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-[8px] px-1.5 text-fg/70 hover:bg-fg/[0.07] hover:text-fg", on && "bg-link/[0.14] text-link hover:bg-link/[0.18] hover:text-link")}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-[18px] w-px shrink-0 bg-fg/10" />;

function Glyph({ d, dots }: { d: string; dots?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
      {dots && [7, 12, 17].map((y) => <circle key={y} cx="4.8" cy={y} r="1.1" fill="currentColor" stroke="none" />)}
    </svg>
  );
}

/** Add, change or remove the link on the selection (Enter applies, Esc leaves). */
function LinkBar({ initial, onApply, onCancel }: { initial: string; onApply: (href: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const href = normalizeHref(v);
  return (
    <div data-link-bar className="flex shrink-0 items-center gap-2 border-b border-fg/[0.07] bg-fg/[0.025] px-3 py-1.5">
      <input
        autoFocus
        aria-label="Link address"
        value={v}
        placeholder="Paste or type a link"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onApply(v);
          } else if (e.key === "Escape") {
            e.stopPropagation(); // the link bar, not the whole editor
            e.nativeEvent.stopImmediatePropagation();
            onCancel();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg/35"
      />
      {initial && href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-link hover:bg-link/[0.08]">
          Open ↗
        </a>
      )}
      {initial && (
        <button onClick={() => onApply("")} className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-fg/55 hover:bg-fg/[0.08]">
          Remove
        </button>
      )}
      <button onClick={() => onApply(v)} className="shrink-0 rounded-full bg-link px-2.5 py-0.5 text-[12px] font-medium text-white">
        Apply
      </button>
    </div>
  );
}
