// Background runner for the connector's task and ticket sync: every minute, plus shortly after they change.
import { activeConnector } from "./connectors";
import { syncTasks } from "./task-sync";
import { syncTickets } from "./ticket-sync";
import { invalidate } from "./cache";

const OWNER = "default"; // single data owner (see identity.ts)
const g = globalThis as unknown as {
  __connTimer?: ReturnType<typeof setInterval>;
  __connSoon?: ReturnType<typeof setTimeout>;
  __ticketSoon?: ReturnType<typeof setTimeout>;
};

export async function runConnectorSync(opts: { idle?: boolean } = {}): Promise<void> {
  const a = await activeConnector();
  if (!a) return;
  if (a.c.tasks) {
    try {
      await syncTasks(OWNER, a.c.tasks);
    } catch (e) {
      console.warn(`[sync] task sync failed: ${(e as Error).message}`);
    }
  }
  if (a.c.tickets) {
    try {
      await syncTickets(OWNER, a.c.tickets, opts);
    } catch (e) {
      console.warn(`[sync] ticket sync failed: ${(e as Error).message}`);
    }
  }
  invalidate("connector:");
}

/** Debounced run after local to-do / plan edits. */
export function scheduleTaskSync(delayMs = 2000) {
  if (g.__connSoon) clearTimeout(g.__connSoon);
  g.__connSoon = setTimeout(() => void runConnectorSync(), delayMs);
}

/**
 * Soon after a ticket edit: tickets only, not behind the task sync. A new ticket waits for this
 * before its description can be written, so it goes at once (the client's push is debounced already).
 */
export function scheduleTicketSync(delayMs = 300) {
  if (g.__ticketSoon) clearTimeout(g.__ticketSoon);
  g.__ticketSoon = setTimeout(async () => {
    const a = await activeConnector();
    if (!a?.c.tickets) return;
    try {
      await syncTickets(OWNER, a.c.tickets);
    } catch (e) {
      console.warn(`[sync] ticket sync failed: ${(e as Error).message}`);
    }
    invalidate("connector:");
  }, delayMs);
}

/** While the app is open (a device syncs every few seconds): read tickets every 20 s instead of every ~2 min. */
export function nudgeTicketPull() {
  void activeConnector().then((a) => {
    if (!a?.c.tickets) return;
    syncTickets(OWNER, a.c.tickets, { idle: true, everyMs: 20_000 })
      .then((sum) => sum.pulled + sum.removed > 0 && invalidate("connector:"))
      .catch((e: Error) => console.warn(`[sync] ticket sync failed: ${e.message}`));
  });
}

export function startConnectorJobs() {
  if (g.__connTimer) return;
  g.__connTimer = setInterval(() => void runConnectorSync({ idle: true }), 60_000);
  scheduleTaskSync(5000);
}
