// Projects (campaigns): what belongs to one, how far along it is, and the time put into it.

import type { Actual, Campaign, Ticket, Todo } from "./types";
import { addDays, logicalDayRange, overlap } from "./time";

/** Its tasks and tickets (removed tickets left out). */
export function campaignItems(c: Campaign, todos: Todo[], tickets: Ticket[]): { todos: Todo[]; tickets: Ticket[] } {
  return {
    todos: todos.filter((t) => t.campaignId === c.id),
    tickets: tickets.filter((t) => t.campaignId === c.id && !t.hidden),
  };
}

/** Done / all of its tasks and tickets (a ticket counts as done once its status is in the complete group). */
/** A project can be marked complete once everything in it is done. */
export const allDone = (p: { done: number; total: number }) => p.total > 0 && p.done === p.total;

export function campaignProgress(c: Campaign, todos: Todo[], tickets: Ticket[]): { done: number; total: number } {
  const it = campaignItems(c, todos, tickets);
  return {
    done: it.todos.filter((t) => t.done).length + it.tickets.filter((t) => t.statusGroup === "complete").length,
    total: it.todos.length + it.tickets.length,
  };
}

/**
 * Time (ms) of actuals in its linked activities from its start (else the day it was made) through its
 * due day (else up to now).
 */
export function campaignTime(c: Campaign, actuals: Actual[], dayStart: number, now: number): number {
  if (!c.activityIds.length) return 0;
  const first = c.start ?? new Date(c.createdAt).setHours(0, 0, 0, 0);
  const from = logicalDayRange(first, dayStart)[0];
  const to = Math.min(now, c.due !== undefined ? logicalDayRange(addDays(c.due, 1), dayStart)[0] : now);
  const ids = new Set(c.activityIds);
  let sum = 0;
  for (const a of actuals) if (ids.has(a.activityId)) sum += overlap(a.start, a.end, from, to);
  return sum;
}

/** "D-3" / "D-day" / "2 days over" against today (both local midnights). */
export function dueLabel(due: number, today: number): string {
  const n = Math.round((due - today) / 86_400_000);
  if (n === 0) return "D-day";
  if (n > 0) return `D-${n}`;
  return n === -1 ? "1 day over" : `${-n} days over`;
}
