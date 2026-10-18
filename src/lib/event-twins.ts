import type { CalendarEvent, CalendarProvider } from "./types";

// the calendar a merged event is shown from: this Mac's (what Calendar.app shows) first
const PREFER: CalendarProvider[] = ["mac", "google", "apple", "ics", "connector"];

/**
 * The same event reaching Sync through two connected calendars (one Google account in Calendar.app and
 * another connected directly, or an invite on two accounts) is shown once. Same title, start, end and
 * all-day = same event. The one shown carries the others' ids in `twins`; hiding any of them hides it.
 */
export function mergeTwins(events: CalendarEvent[], hiddenIds: Set<string>): CalendarEvent[] {
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const k = `${e.title.trim().toLowerCase()}|${e.start}|${e.end}|${e.allDay ? 1 : 0}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: CalendarEvent[] = [];
  for (const g of groups.values()) {
    if (g.some((e) => hiddenIds.has(e.id))) continue;
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    const [keep, ...rest] = [...g].sort((a, b) => PREFER.indexOf(a.provider) - PREFER.indexOf(b.provider) || a.id.localeCompare(b.id));
    out.push({ ...keep, twins: rest.map((e) => e.id) });
  }
  return out;
}

/** An event (or one of its twins) is in `ids`. */
export const eventIn = (ids: Set<string | undefined>, e: CalendarEvent) => ids.has(e.id) || !!e.twins?.some((id) => ids.has(id));
