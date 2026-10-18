import type { Artifact, ArtifactDoc } from "./types";

/** A project's artifacts in their order (ties: as made). */
export function artifactsOf(all: Artifact[], campaignId: string): Artifact[] {
  return all.filter((a) => a.campaignId === campaignId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** The order key for a new artifact: after the project's last one. */
export function nextOrder(all: Artifact[], campaignId: string): number {
  const mine = all.filter((a) => a.campaignId === campaignId);
  return mine.length ? Math.max(...mine.map((a) => a.order)) + 1 : 0;
}

/**
 * New order keys after moving `id` to `index` among its project's artifacts (0 = first): only the ones
 * that change. Every sibling is renumbered 0..n-1 so equal or stale keys can't put the move back.
 */
export function moveKeys(all: Artifact[], id: string, index: number): Map<string, number> {
  const me = all.find((a) => a.id === id);
  if (!me) return new Map();
  const sibs = artifactsOf(all, me.campaignId);
  const rest = sibs.filter((a) => a.id !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  const next = [...rest.slice(0, at), me, ...rest.slice(at)];
  const out = new Map<string, number>();
  next.forEach((a, i) => {
    if (a.order !== i) out.set(a.id, i);
  });
  return out;
}

const BLOCKS = new Set(["paragraph", "heading", "blockquote", "listItem", "taskItem", "codeBlock"]);

/** The document's text, blocks separated by spaces, cut at `max` characters (for a node's preview). */
export function docText(doc: ArtifactDoc | null | undefined, max = 140): string {
  if (!doc) return "";
  let out = "";
  const walk = (n: ArtifactDoc) => {
    if (out.length > max) return;
    if (n.type === "text" && n.text) out += n.text;
    else if (n.type === "hardBreak") out += " ";
    for (const c of n.content ?? []) walk(c);
    if (BLOCKS.has(n.type) && !out.endsWith(" ")) out += " ";
  };
  walk(doc);
  const t = out.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** Image sources in a document (for checks: only uploaded media, never data: URLs, belong in the record). */
export function docImages(doc: ArtifactDoc | null | undefined): string[] {
  const out: string[] = [];
  const walk = (n: ArtifactDoc) => {
    if (n.type === "image" && typeof n.attrs?.src === "string") out.push(n.attrs.src);
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return out;
}

/** The document with any data: images taken out (a paste can carry them; the record must not). */
export function withoutInlineImages(doc: ArtifactDoc): ArtifactDoc {
  const strip = (n: ArtifactDoc): ArtifactDoc | null => {
    if (n.type === "image" && typeof n.attrs?.src === "string" && !/^(\/api\/artifacts\/media\?|https?:\/\/)/.test(n.attrs.src)) return null;
    if (!n.content) return n;
    const content = n.content.map(strip).filter((c): c is ArtifactDoc => c !== null);
    return content.length === n.content.length && content.every((c, i) => c === n.content![i]) ? n : { ...n, content };
  };
  return strip(doc) ?? { type: "doc", content: [] };
}

/** Where an uploaded artifact image is served from. */
export const mediaUrl = (name: string) => `/api/artifacts/media?name=${encodeURIComponent(name)}`;

/** "Edited …" for a node: just now, minutes / hours ago, yesterday, then the date. */
export function editedLabel(t: number, now: number): string {
  const m = Math.floor((now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 12 * 60) return `${Math.floor(m / 60)}h ago`;
  const day = (x: number) => new Date(x).setHours(0, 0, 0, 0);
  const days = Math.round((day(now) - day(t)) / 86_400_000);
  if (days === 0) return `${Math.floor(m / 60)}h ago`;
  if (days === 1) return "yesterday";
  const d = new Date(t);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

/**
 * Where each project's nodes start on the canvas: level with its card, or lower when the previous
 * project's nodes still run there (`gap` apart). `bottom` = below the last node.
 */
export function stackGroups(cards: { id: string; top: number; count: number }[], nodeH: number, step: number, gap: number): { tops: number[]; bottom: number } {
  let floor = 0;
  const tops = cards.map((c) => {
    const top = Math.max(c.top, floor);
    if (c.count) floor = top + (c.count - 1) * step + nodeH + gap;
    return top;
  });
  return { tops, bottom: floor };
}
