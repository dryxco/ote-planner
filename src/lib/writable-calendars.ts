"use client";

import { useEffect, useState } from "react";
import { PROVIDER_LABEL, type CalendarInfo, type CalendarsResponse } from "./types";

// the connected calendars (fetched once per page load)
let allCals: Promise<CalendarInfo[]> | null = null;

export function loadCalendars(): Promise<CalendarInfo[]> {
  allCals ??= fetch("/api/calendar/calendars", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<CalendarsResponse>) : { calendars: [] as CalendarInfo[] }))
    .then((d) => d.calendars)
    .catch(() => {
      allCals = null;
      return [];
    });
  return allCals;
}

/** This Mac's calendars Ote may add events to. */
export function loadWritableCalendars(): Promise<CalendarInfo[]> {
  return loadCalendars().then((cs) => cs.filter((c) => c.provider === "mac" && c.writable));
}

/** "Work · Google" for an event's calendar id (undefined until loaded / when unknown). */
export function useCalendarLabel(calendarId: string | undefined): string | undefined {
  const [cals, setCals] = useState<CalendarInfo[] | null>(null);
  useEffect(() => {
    if (!calendarId) return;
    let live = true;
    loadCalendars().then((cs) => live && setCals(cs));
    return () => {
      live = false;
    };
  }, [calendarId]);
  const c = calendarId ? cals?.find((x) => x.id === calendarId) : undefined;
  return c ? `${c.name} · ${PROVIDER_LABEL[c.provider]}` : undefined;
}
