"use client";

import { useEffect, useState } from "react";
import { redo, startUndo, undo } from "@/lib/undo";

/** Keyboard undo/redo for the app's data (text fields keep their own native undo). */
export function UndoKeys() {
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);

  useEffect(() => {
    const stop = startUndo();
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      const isRedo = (k === "z" && e.shiftKey) || (k === "y" && e.ctrlKey && !e.metaKey);
      const isUndo = k === "z" && !e.shiftKey;
      if (!isUndo && !isRedo) return;
      e.preventDefault();
      const ok = isRedo ? redo() : undo();
      setToast({ text: ok ? (isRedo ? "Redone" : "Undone") : isRedo ? "Nothing to redo" : "Nothing to undo", at: Date.now() });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(id);
  }, [toast]);

  if (!toast) return null;
  return (
    <div data-undo-toast className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex justify-center">
      <span key={toast.at} className="animate-fade rounded-full bg-fg px-3.5 py-1.5 text-[13px] font-medium text-bg shadow-lg">
        {toast.text}
      </span>
    </div>
  );
}
