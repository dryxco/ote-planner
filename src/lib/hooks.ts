"use client";

import { mergeTwins } from "./event-twins";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PROVIDER_LABEL, type CalendarEvent, type EventsResponse } from "./types";
import { useSync } from "./store";

/** True once the persisted store has rehydrated from localStorage (client only). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => useSync.persist.onFinishHydration(cb),
    () => useSync.persist.hasHydrated(),
    () => false,
  );
}

/** Current time, ticking every `everyMs`. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, everyMs);
    // timers pause while the app is in the background; catch up the moment it's visible again
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
  }, [everyMs]);
  return now;
}

// ---- calendar events (Google / Apple via /api/calendar/events) ----

const cache = new Map<string, { at: number; events: CalendarEvent[] }>();
const failures = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

/** Invalidate cached events (after connecting / disconnecting accounts). */
export function refreshCalendarEvents() {
  cache.clear();
  version++;
  listeners.forEach((l) => l());
}

export interface CalendarEventsState {
  events: CalendarEvent[];
  errors: string[];
  loading: boolean;
}

export function useCalendarEvents(start: number, end: number): CalendarEventsState {
  const { showCalendarEvents, hiddenCalendarIds, hiddenEventIds } = useSync((s) => s.settings);
  const v = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => 0,
  );
  const key = `${start}-${end}`;
  const [state, setState] = useState<{ key: string; v: number; events: CalendarEvent[]; errors: string[] }>({
    key: "",
    v: -1,
    events: [],
    errors: [],
  });
  const [retry, setRetry] = useState(0);
  // re-fetch at most once a minute while the view stays open
  const tick = useNow(60_000);
  const hit = cache.get(key);
  const fresh = hit && hit.at > tick - 60_000 ? hit : undefined;

  useEffect(() => {
    if (!showCalendarEvents || fresh) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    fetch(`/api/calendar/events?start=${start}&end=${end}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`)
      .then(async (r) => {
        if (r.status === 404) return { events: [] } as EventsResponse; // integrations not installed
        if (!r.ok) throw new Error(`Couldn't load calendar events (HTTP ${r.status})`);
        return (await r.json()) as EventsResponse;
      })
      .then((res) => {
        if (cancelled) return;
        failures.delete(key);
        cache.set(key, { at: Date.now(), events: res.events });
        setState({
          key,
          v,
          events: res.events,
          errors: (res.errors ?? []).map((e) => `${PROVIDER_LABEL[e.provider] ?? e.provider}: ${e.message}`),
        });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // Retry with backoff (server restarting, phone switching networks…). Keep what's on screen,
        // and only surface a plain network failure once it has happened twice in a row.
        const n = (failures.get(key) ?? 0) + 1;
        failures.set(key, n);
        const network = e instanceof TypeError; // "Load failed" / "Failed to fetch"
        setState((prev) => ({
          key,
          v,
          events: prev.key === key ? prev.events : (cache.get(key)?.events ?? []),
          errors: network && n < 2 ? [] : [network ? "Can't reach the server — retrying…" : e.message],
        }));
        retryTimer = setTimeout(() => setRetry((r) => r + 1), Math.min(30_000, 2_000 * 2 ** (n - 1)));
      });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [key, start, end, v, showCalendarEvents, fresh, retry]);

  const current = state.key === key ? state : null;
  const raw = current?.events ?? fresh?.events;
  const hidden = useMemo(() => new Set(hiddenCalendarIds), [hiddenCalendarIds]);
  const hiddenEvents = useMemo(() => new Set(hiddenEventIds ?? []), [hiddenEventIds]);
  const events = useMemo(
    () => (showCalendarEvents && raw ? mergeTwins(raw.filter((e) => !hidden.has(e.calendarId)), hiddenEvents) : []),
    [showCalendarEvents, raw, hidden, hiddenEvents],
  );
  return { events, errors: showCalendarEvents ? (current?.errors ?? []) : [], loading: showCalendarEvents && !raw };
}
