// iCalendar (RFC 5545) -> CalendarEvent mapping with local recurrence expansion.
import ICAL from "ical.js";
import type { CalendarEvent, CalendarInfo } from "../types";
import { isValidTimeZone, midnightMs, wallTimeToMs } from "./time";

type Time = InstanceType<typeof ICAL.Time>;
type Component = InstanceType<typeof ICAL.Component>;
type Event = InstanceType<typeof ICAL.Event>;

const DAY_MS = 86_400_000;
/** Hard stop for runaway RRULEs (e.g. FREQ=MINUTELY with no end). */
const MAX_ITERATIONS = 20_000;

export interface Range {
  start: number;
  end: number;
}

/**
 * Convert an ICAL.Time to epoch ms.
 * - DATE values -> local midnight in `targetTz`.
 * - UTC values -> exact instant.
 * - TZID that is a known IANA zone -> resolved with Intl (current tz database).
 * - TZID backed by an in-file VTIMEZONE (e.g. Windows names) -> ical.js offsets.
 * - Floating / unknown TZID -> wall time in `targetTz`.
 */
export function icalTimeToMs(t: Time, tzid: string | undefined, targetTz?: string): number {
  if (t.isDate) return midnightMs(t.year, t.month, t.day, targetTz);
  const zoneId = t.zone?.tzid;
  if (zoneId === "UTC" || zoneId === "Z") return t.toUnixTime() * 1000;
  if (tzid && isValidTimeZone(tzid)) {
    return wallTimeToMs(t.year, t.month, t.day, t.hour, t.minute, t.second, tzid);
  }
  if (t.zone && zoneId && zoneId !== "floating") return t.toUnixTime() * 1000;
  return wallTimeToMs(t.year, t.month, t.day, t.hour, t.minute, t.second, targetTz);
}

function approxWallMs(t: Time): number {
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
}

function tzidOf(item: Event, prop: "dtstart" | "dtend"): string | undefined {
  const p = item.component.getFirstProperty(prop);
  const v = p?.getParameter("tzid");
  return typeof v === "string" ? v : undefined;
}

function text(item: Event, name: string): string | undefined {
  const v = item.component.getFirstPropertyValue(name);
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

function isCancelled(item: Event): boolean {
  return String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
}

function build(
  item: Event,
  uid: string,
  start: Time,
  end: Time,
  recurrenceId: Time | null,
  cal: CalendarInfo,
  targetTz: string | undefined,
): CalendarEvent | null {
  const allDay = start.isDate;
  const startTz = tzidOf(item, "dtstart");
  const s = icalTimeToMs(start, startTz, targetTz);
  let e = icalTimeToMs(end, tzidOf(item, "dtend") ?? startTz, targetTz);
  if (!Number.isFinite(s)) return null;
  if (!Number.isFinite(e) || e < s) e = s;
  if (allDay && e <= s) {
    // DTSTART;VALUE=DATE with no DTEND/DURATION is a one-day event (RFC 5545 3.6.1).
    e = midnightMs(start.year, start.month, start.day + 1, targetTz);
  }
  // Stable key: the original slot of a recurring instance (RECURRENCE-ID), so a moved
  // occurrence keeps its id; otherwise the event start.
  const occurrenceKey = recurrenceId ? icalTimeToMs(recurrenceId, startTz, targetTz) : s;
  return {
    id: `${cal.id}:${uid}:${occurrenceKey}`,
    uid,
    calendarId: cal.id,
    provider: cal.provider,
    title: text(item, "summary") ?? "(No title)",
    start: s,
    end: e,
    allDay,
    location: text(item, "location"),
    notes: text(item, "description"),
    color: cal.color,
  };
}

function overlaps(ev: CalendarEvent, range: Range): boolean {
  // Zero-length events at range.start still count.
  return ev.start < range.end && (ev.end > range.start || ev.start >= range.start);
}

/**
 * Map one or more VCALENDAR documents (each CalDAV object is usually one) to events
 * overlapping `range`, expanding RRULE/RDATE/EXDATE and applying RECURRENCE-ID overrides.
 * `targetTz` is the IANA zone used for all-day and floating times (default: server local).
 */
export function icsToEvents(
  ics: string | string[],
  cal: CalendarInfo,
  range: Range,
  targetTz?: string,
): CalendarEvent[] {
  const docs = Array.isArray(ics) ? ics : [ics];
  const masters = new Map<string, Event>();
  const exceptions = new Map<string, Event[]>();

  for (const doc of docs) {
    if (!doc || !doc.trim()) continue;
    let root: Component;
    try {
      root = new ICAL.Component(ICAL.parse(doc));
    } catch {
      continue; // one malformed object must not hide the rest of the calendar
    }
    const vcals = root.name === "vcalendar" ? [root] : root.getAllSubcomponents("vcalendar");
    for (const vcal of vcals) {
      for (const vevent of vcal.getAllSubcomponents("vevent")) {
        const ev = new ICAL.Event(vevent);
        const uid = ev.uid || `nouid-${masters.size + exceptions.size}`;
        if (vevent.hasProperty("recurrence-id")) {
          const list = exceptions.get(uid) ?? [];
          list.push(ev);
          exceptions.set(uid, list);
        } else {
          masters.set(uid, ev);
        }
      }
    }
  }

  const out: CalendarEvent[] = [];
  const push = (ev: CalendarEvent | null) => {
    if (ev && overlaps(ev, range)) out.push(ev);
  };

  for (const [uid, master] of masters) {
    const excs = exceptions.get(uid) ?? [];
    exceptions.delete(uid);
    if (!master.startDate) continue;

    if (!master.isRecurring()) {
      if (!isCancelled(master)) push(build(master, uid, master.startDate, master.endDate ?? master.startDate, null, cal, targetTz));
      continue;
    }

    for (const exc of excs) master.relateException(exc);
    if (isCancelled(master)) continue;

    const it = master.iterator();
    let next: Time | null;
    let n = 0;
    while ((next = it.next()) && n++ < MAX_ITERATIONS) {
      const details = master.getOccurrenceDetails(next);
      const item = details.item;
      // Cheap skip for unmodified occurrences that end well before the range
      // (zone offsets are < 1 day, so a 2-day margin is safe without Intl lookups).
      if (item === master && approxWallMs(details.endDate) + 2 * DAY_MS < range.start) continue;
      // Slots are chronological; stop a week past the range (overrides moved more than
      // a week earlier than their original slot are not picked up).
      const slotMs = icalTimeToMs(details.recurrenceId, tzidOf(master, "dtstart"), targetTz);
      if (slotMs >= range.end + 7 * DAY_MS) break;
      if (isCancelled(item)) continue;
      push(build(item, uid, details.startDate, details.endDate, details.recurrenceId, cal, targetTz));
    }
  }

  // Overrides whose master wasn't returned (server sent only the changed instance).
  for (const [uid, list] of exceptions) {
    for (const exc of list) {
      if (isCancelled(exc) || !exc.startDate) continue;
      const rid = exc.recurrenceId ?? null;
      push(build(exc, uid, exc.startDate, exc.endDate ?? exc.startDate, rid, cal, targetTz));
    }
  }

  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}
