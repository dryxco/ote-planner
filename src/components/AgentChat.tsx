"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { agentContext, applyAgentOps, loadAgentCalendars, type AgentOp } from "@/lib/agent-ops";
import { undo } from "@/lib/undo";
import { useFinePointer } from "@/lib/media";
import { cx } from "./ui";

interface Msg {
  role: "user" | "assistant";
  text: string;
  /** what was applied (assistant turns) */
  results?: string[];
  error?: boolean;
  undone?: boolean;
  /** pasted images (data: URLs; kept in memory only) */
  images?: string[];
}

/** Pasted images are scaled down (longest side 1600px, JPEG) before they're sent. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = url;
    });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; // transparent PNGs → white, not black, as JPEG
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const STORE_KEY = "sync-agent-chat";

/**
 * Chat with an agent that edits Ote for you ("gym tomorrow at 7 for an hour"). The agent answers with
 * operations; they're applied right away here and can be undone (button or ⌘Z) as one step.
 */
export function AgentChat({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "[]") as Msg[];
    } catch {
      return [];
    }
  });
  const [text, setText] = useState("");
  const [pasted, setPasted] = useState<string[]>([]);
  const fine = useFinePointer();
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // the panel lives in <body> (above the timeline), anchored under the button
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  // tapping anywhere else (or opening something else) closes the panel
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      // keep the whole panel on screen (12px gutters), right-aligned under the button when it fits
      const w = Math.min(380, window.innerWidth - 24);
      setAnchor({ top: r.bottom + 10, right: Math.min(Math.max(12, window.innerWidth - r.right), window.innerWidth - w - 12) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-40).map(({ images, ...m }) => (images ? { ...m, text: `${m.text} [${images.length} image]` } : m))));
    } catch {}
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs, open]);

  async function send() {
    const q = text.trim() || (pasted.length ? "(see the image)" : "");
    if (!q || busy) return;
    const imgs = pasted;
    const next: Msg[] = [...msgs, { role: "user", text: q, ...(imgs.length ? { images: imgs } : {}) }];
    setMsgs(next);
    setText("");
    setPasted([]);
    setBusy(true);
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // what the app actually applied goes along, so the agent knows its earlier edits landed
          history: next
            .filter((m) => !m.error)
            .map((m) => ({ role: m.role, text: m.results?.length ? `${m.text}\n[Applied in the app: ${m.results.join("; ")}]` : m.text })),
          context: await loadAgentCalendars().then(agentContext, agentContext),
          images: imgs.map((d) => ({ media_type: d.slice(5, d.indexOf(";")), data: d.slice(d.indexOf(",") + 1) })),
        }),
      });
      const body = (await r.json().catch(() => ({}))) as { reply?: string; ops?: AgentOp[]; error?: string };
      if (!r.ok || body.error) throw new Error(body.error ?? `HTTP ${r.status}`);
      const results = body.ops?.length ? applyAgentOps(body.ops) : [];
      setMsgs((m) => [...m, { role: "assistant", text: body.reply || "Done.", results }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `Error: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx("relative", className)}>
      <button
        ref={btnRef}
        aria-label="Agent chat"
        aria-expanded={open}
        title="Ask the agent to edit your plans"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "flex h-[30px] w-[30px] items-center justify-center rounded-full text-fg/80 transition-colors",
          open ? "bg-fg/[0.12]" : "hover:bg-fg/[0.07]",
        )}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5.5h16v11H9.5L5 20v-3.5H4z" />
          <path d="M8.5 9.5h7M8.5 12.5h4.5" />
        </svg>
      </button>

      {open && anchor && createPortal(
        <div
          ref={panelRef}
          data-agent-chat
          style={{ top: anchor.top, right: anchor.right }}
          className="animate-fade fixed z-[45] flex max-h-[min(520px,65vh)] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-[14px] border border-fg/[0.08] bg-surface-0 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        >
          {msgs.length > 0 && (
            <div className="flex justify-end gap-3 px-4 pt-2.5 text-[11.5px] text-fg/40">
              <button onClick={() => setMsgs([])} className="hover:text-fg/75">
                Clear
              </button>
            </div>
          )}
          {(msgs.length > 0 || busy) && (
            <div ref={listRef} className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-1 pt-2">
              {msgs.map((m, i) => (
                <div key={i} className={cx("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
                  <div
                    className={cx(
                      "max-w-[85%] whitespace-pre-wrap rounded-[16px] px-3 py-2 text-[13.5px] leading-snug",
                      m.role === "user" ? "bg-fg/[0.08]" : m.error ? "text-danger-soft" : "",
                    )}
                  >
                    {m.images && (
                      <span className="mb-1 flex flex-wrap justify-end gap-1">
                        {m.images.map((src, j) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={j} src={src} alt="" className="h-[64px] max-w-[120px] rounded-[8px] object-cover" />
                        ))}
                      </span>
                    )}
                    {m.text}
                  </div>
                  {m.results && m.results.length > 0 && (
                    <div data-agent-results className="max-w-[85%] px-3 text-[11px] leading-snug text-fg/45">
                      {m.results.map((r, j) => (
                        <div key={j} className={r.startsWith("✗") ? "text-danger-soft" : undefined}>
                          {r}
                        </div>
                      ))}
                      {m.results.some((r) => r.startsWith("✓")) && !m.undone && i === msgs.length - 1 && (
                        <button
                          onClick={() => {
                            if (undo()) setMsgs((xs) => xs.map((x, k) => (k === i ? { ...x, undone: true } : x)));
                          }}
                          className="mt-1 font-medium text-fg/70 underline underline-offset-2"
                        >
                          Undo
                        </button>
                      )}
                      {m.undone && <div className="mt-1">Undone</div>}
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="w-fit animate-pulse px-3 py-2 text-[13px] text-fg/45">…</div>}
            </div>
          )}
          <div className="p-2">
            {pasted.length > 0 && (
              <div data-agent-pasted className="flex flex-wrap gap-1.5 px-1 pb-1.5">
                {pasted.map((src, i) => (
                  <span key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-[52px] w-[52px] rounded-[8px] object-cover" />
                    <button
                      aria-label="Remove image"
                      onClick={() => setPasted((xs) => xs.filter((_, k) => k !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-fg text-[11px] leading-none text-bg"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5 rounded-[12px] border border-fg/[0.08] bg-surface py-1.5 pl-3.5 pr-1.5 shadow-sm">
              <textarea
                aria-label="Message the agent"
                autoFocus
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  // paste screenshots / images straight in (no upload button)
                  const files = [...e.clipboardData.items].filter((it) => it.kind === "file" && it.type.startsWith("image/")).map((it) => it.getAsFile()!).filter(Boolean);
                  if (!files.length) return;
                  e.preventDefault();
                  void Promise.all(files.map(shrink)).then((urls) => setPasted((xs) => [...xs, ...urls].slice(0, 4)));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Send to Agent ..."
                className="field-sizing-content max-h-[120px] min-h-[30px] flex-1 resize-none bg-transparent py-[5px] text-[14px] leading-[20px] outline-none placeholder:text-fg/35"
              />
              {/* phones: pick from the photo library (desktop pastes instead) */}
              {!fine && (
                <label aria-label="Add photo" className="flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center self-end rounded-[8px] text-fg/55 hover:bg-fg/[0.06]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
                    <circle cx="9" cy="10" r="1.6" />
                    <path d="m4.5 17 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5" />
                  </svg>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    data-agent-photo
                    className="hidden"
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith("image/"));
                      e.target.value = "";
                      if (files.length) void Promise.all(files.map(shrink)).then((urls) => setPasted((xs) => [...xs, ...urls].slice(0, 4)));
                    }}
                  />
                </label>
              )}
              <button
                aria-label="Send"
                disabled={busy || (!text.trim() && pasted.length === 0)}
                onClick={() => void send()}
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-fg text-bg transition-opacity disabled:opacity-25"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
                </svg>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
