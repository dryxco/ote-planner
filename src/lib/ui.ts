"use client";

import { create } from "zustand";
import type { CalendarEvent } from "./types";
import { startOfDay } from "./time";

export type EntryKind = "plan" | "actual" | "todo";

/** What the entry sheet is editing / creating. */
export type EntryTarget =
  | {
      mode: "new";
      kind: EntryKind;
      start?: number;
      end?: number;
      fromEvent?: CalendarEvent;
      /** Plan occurrence key: prefill name/activity and link the actual to it. */
      fromPlan?: string;
      date?: number;
    }
  | { mode: "edit"; kind: "plan"; id: string; occurrenceStart: number }
  | { mode: "edit"; kind: "actual"; id: string }
  | { mode: "edit"; kind: "todo"; id: string };

interface UIState {
  /** Selected calendar date (local midnight) shared by Today / Calendar. */
  date: number;
  entry: EntryTarget | null;
  settingsOpen: boolean;
  /** Reason passed back from the Google OAuth callback (?calendarError=...). */
  calendarError: string | null;
  setCalendarError(e: string | null): void;
  setDate(d: number): void;
  openEntry(t: EntryTarget): void;
  closeEntry(): void;
  setSettingsOpen(open: boolean): void;
}

export const useUI = create<UIState>()((set) => ({
  date: startOfDay(Date.now()),
  entry: null,
  settingsOpen: false,
  calendarError: null,
  setCalendarError: (e) => set({ calendarError: e }),
  setDate: (d) => set({ date: startOfDay(d) }),
  openEntry: (t) => set({ entry: t }),
  closeEntry: () => set({ entry: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
