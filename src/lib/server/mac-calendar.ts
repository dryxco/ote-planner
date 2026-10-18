// Calendars from this Mac's Apple Calendar (iCloud, Google, Exchange, subscriptions — whatever the
// Calendar app shows) through the EventKit helper .bin/OteCalendar.app (tools/ekexport). Read-only.
// The helper is launched through LaunchServices (`open`) so macOS attributes the calendar permission
// to it, not to node.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CalendarEvent, CalendarInfo } from "../types";
import { ProviderError } from "./http";
import type { Range } from "./ics";
import { writtenEventIds } from "./calendar-writer";

// The live server runs from a release copy; the helper (and its calendar permission) stays in the repo.
const APP = process.env.OTE_CAL_APP || path.join(process.cwd(), ".bin", "OteCalendar.app");
const SOURCE_TYPES: Record<number, string> = { 0: "On My Mac", 1: "Exchange", 2: "CalDAV", 3: "MobileMe", 4: "Subscribed", 5: "Birthdays" };

// `open -W` can fail to *wait* when several helpers start at once ("Unable to block on application")
// even though the helper runs fine, so its exit code isn't trusted: the result file is.
async function readResult(out: string, deadline: number): Promise<{ error?: string } | null> {
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(out, "utf8")) as { error?: string };
    } catch {
      await new Promise((r) => setTimeout(r, 100)); // not written yet (or still being written)
    }
  }
  return null;
}

export function runHelper(args: string[]): Promise<unknown> {
  const out = path.join(os.tmpdir(), `sync-cal-${randomBytes(6).toString("hex")}.json`);
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/open", ["-W", "-n", "-g", "-a", APP, "--args", ...args, out], { timeout: 20_000 }, async (err, _o, stderr) => {
      try {
        const data = await readResult(out, Date.now() + (err ? 10_000 : 2_000));
        if (!data) {
          const why = String(stderr || err?.message || "no output").trim().slice(0, 200);
          throw new ProviderError(`Mac calendar helper isn't responding (${why}) — check that it was built with tools/ekexport/build.sh`);
        }
        if (data.error) {
          throw new ProviderError(
            data.error === "calendar access denied"
              ? "Mac calendar access denied — allow 'Ote Calendar' in System Settings → Privacy & Security → Calendars"
              : `Mac calendar error: ${data.error}`,
          );
        }
        resolve(data);
      } catch (e) {
        reject(e);
      } finally {
        fs.rm(out, { force: true }).catch(() => {});
      }
    });
  });
}

interface RawCal {
  id: string;
  title: string;
  source: string;
  sourceType: number;
  color: string;
  writable?: boolean;
}

export async function listMacCalendars(): Promise<CalendarInfo[]> {
  const d = (await runHelper(["calendars"])) as { calendars: RawCal[] };
  return d.calendars.map((c) => ({
    id: `mac:local:${c.id}`,
    provider: "mac" as const,
    accountId: c.source || SOURCE_TYPES[c.sourceType] || "Mac",
    name: c.title,
    color: c.color,
    writable: !!c.writable,
  }));
}

export async function listMacEvents(range: Range): Promise<CalendarEvent[]> {
  const d = (await runHelper(["events", String(range.start), String(range.end)])) as {
    events: { calendarId: string; id: string; title: string; start: number; end: number; allDay: boolean; color: string; location?: string; ekId?: string }[];
  };
  // events Ote put on a calendar are already on the timeline as their plans: no ghost for them
  const mine = await writtenEventIds();
  return d.events.filter((e) => !e.ekId || !mine.has(e.ekId)).map((e) => ({
    id: `mac:local:${e.calendarId}:${e.id}`,
    calendarId: `mac:local:${e.calendarId}`,
    provider: "mac" as const,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    location: e.location,
    color: e.color,
  }));
}
