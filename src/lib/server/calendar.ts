// Aggregates all connected accounts. One failing account never fails the whole response.
import { PROVIDER_LABEL, type CalendarAccount, type CalendarEvent, type CalendarInfo, type CalendarProvider, type CalendarsResponse, type EventsResponse } from "../types";
import { listAppleCalendars, listAppleEvents } from "./apple";
import { cached } from "./cache";
import { activeConnector } from "./connectors";
import { listGoogleCalendars, listGoogleEvents } from "./google";
import { icsCalendarInfo, listIcsEvents } from "./ics-subscriptions";
import { listMacCalendars, listMacEvents } from "./mac-calendar";
import { writtenEventUids } from "./calendar-writer";
import { errorMessage } from "./http";
import type { Range } from "./ics";
import { getStore, type IntegrationStore } from "./store";

type ErrorItem = NonNullable<CalendarsResponse["errors"]>[number];

async function loadStore(errors: ErrorItem[]): Promise<IntegrationStore | null> {
  try {
    return await getStore();
  } catch (err) {
    const message = errorMessage(err, "Couldn't read connections");
    errors.push({ provider: "google", message }, { provider: "apple", message }, { provider: "ics", message });
    return null;
  }
}

function accountsOf(store: IntegrationStore): CalendarAccount[] {
  return [
    ...store.google.map((a) => ({ provider: "google" as const, accountId: a.accountId, label: a.email })),
    ...store.apple.map((a) => ({ provider: "apple" as const, accountId: a.accountId, label: a.appleId })),
    ...store.ics.map((a) => ({ provider: "ics" as const, accountId: a.accountId, label: a.name })),
    ...(store.connector ? [{ provider: "connector" as const, accountId: store.connector.account.id, label: store.connector.account.label }] : []),
    ...(store.mac ? [{ provider: "mac" as const, accountId: "local", label: "This Mac's calendars (Apple Calendar)" }] : []),
  ];
}

function prefixed(provider: CalendarProvider, label: string, err: unknown): string {
  const name = PROVIDER_LABEL[provider];
  return `${label}: ${errorMessage(err, `${name} calendar error`)}`;
}

export async function getCalendars(): Promise<CalendarsResponse> {
  const errors: ErrorItem[] = [];
  const store = await loadStore(errors);
  if (!store) return { accounts: [], calendars: [], errors };

  const calendars: CalendarInfo[] = [];
  await Promise.all([
    ...store.google.map(async (acc) => {
      try {
        calendars.push(...(await cached(`google:${acc.accountId}:calendars`, () => listGoogleCalendars(acc))));
      } catch (err) {
        errors.push({ provider: "google", accountId: acc.accountId, message: prefixed("google", acc.email, err) });
      }
    }),
    ...store.apple.map(async (acc) => {
      try {
        calendars.push(...(await cached(`apple:${acc.accountId}:calendars`, () => listAppleCalendars(acc))));
      } catch (err) {
        errors.push({ provider: "apple", accountId: acc.accountId, message: prefixed("apple", acc.appleId, err) });
      }
    }),
  ]);
  calendars.push(...store.ics.map(icsCalendarInfo));
  const conn = await activeConnector();
  if (conn?.c.calendar) {
    try {
      calendars.push(...(await cached(`connector:${conn.conn.account.id}:calendars`, () => conn.c.calendar!.calendars())));
    } catch (err) {
      errors.push({ provider: "connector", accountId: conn.conn.account.id, message: prefixed("connector", conn.conn.account.label, err) });
    }
  }
  if (store.mac) {
    try {
      calendars.push(...(await cached("mac:calendars", listMacCalendars)));
    } catch (err) {
      errors.push({ provider: "mac", message: prefixed("mac", "Mac", err) });
    }
  }
  calendars.sort((a, b) => a.provider.localeCompare(b.provider) || a.accountId.localeCompare(b.accountId) || a.name.localeCompare(b.name));
  return { accounts: accountsOf(store), calendars, ...(errors.length ? { errors } : {}) };
}

export async function getEvents(range: Range, tz?: string): Promise<EventsResponse> {
  const errors: ErrorItem[] = [];
  const store = await loadStore(errors);
  if (!store) return { events: [], errors };

  const events: CalendarEvent[] = [];
  const rangeKey = `${range.start}-${range.end}-${tz ?? ""}`;

  await Promise.all([
    ...store.google.map(async (acc) => {
      try {
        const result = await cached(`google:${acc.accountId}:events:${rangeKey}`, async () => {
          const cals = await cached(`google:${acc.accountId}:calendars`, () => listGoogleCalendars(acc));
          const evs: CalendarEvent[] = [];
          const calErrors: string[] = [];
          await Promise.all(
            cals.map(async (cal) => {
              try {
                evs.push(...(await listGoogleEvents(acc, cal, range, tz)));
              } catch (err) {
                // Account-wide auth problems fail the account; others only that calendar.
                if ((err as { needsReconnect?: boolean }).needsReconnect) throw err;
                calErrors.push(`${cal.name}: ${errorMessage(err, "Google Calendar error")}`);
              }
            }),
          );
          return { events: evs, errors: calErrors };
        });
        events.push(...result.events);
        for (const m of result.errors) errors.push({ provider: "google", accountId: acc.accountId, message: `${acc.email} · ${m}` });
      } catch (err) {
        errors.push({ provider: "google", accountId: acc.accountId, message: prefixed("google", acc.email, err) });
      }
    }),
    ...store.apple.map(async (acc) => {
      try {
        const result = await cached(`apple:${acc.accountId}:events:${rangeKey}`, () => listAppleEvents(acc, range, tz));
        events.push(...result.events);
        for (const m of result.errors) errors.push({ provider: "apple", accountId: acc.accountId, message: `${acc.appleId} · ${m}` });
      } catch (err) {
        errors.push({ provider: "apple", accountId: acc.accountId, message: prefixed("apple", acc.appleId, err) });
      }
    }),
    (async () => {
      const conn = await activeConnector();
      if (!conn?.c.calendar) return;
      try {
        events.push(...(await cached(`connector:${conn.conn.account.id}:events:${rangeKey}`, () => conn.c.calendar!.events(range, tz))));
      } catch (err) {
        errors.push({ provider: "connector", accountId: conn.conn.account.id, message: prefixed("connector", conn.conn.account.label, err) });
      }
    })(),
    ...(store.mac
      ? [
          (async () => {
            try {
              events.push(...(await cached(`mac:events:${rangeKey}`, () => listMacEvents(range))));
            } catch (err) {
              errors.push({ provider: "mac", message: prefixed("mac", "Mac", err) });
            }
          })(),
        ]
      : []),
    ...store.ics.map(async (sub) => {
      try {
        events.push(...(await cached(`ics:${sub.accountId}:events:${rangeKey}`, () => listIcsEvents(sub, range, tz))));
      } catch (err) {
        errors.push({ provider: "ics", accountId: sub.accountId, message: prefixed("ics", sub.name, err) });
      }
    }),
  ]);

  // events Ote put on a calendar are already on the timeline as their plans (the Mac source drops its
  // copy; this drops the one an ICS feed / iCloud of the same calendar brings back)
  const mine = await writtenEventUids();
  const shown = events.filter((e) => !e.uid || !mine.has(e.uid));
  shown.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  return { events: shown, ...(errors.length ? { errors } : {}) };
}
