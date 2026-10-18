// Wall-clock <-> epoch ms conversion for an IANA time zone, using only Intl.
// `tz` undefined means the server process's local zone.

const dtfCache = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function formatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Offset (ms) of `tz` from UTC at instant `ms`: local = utc + offset. */
function offsetAt(ms: number, tz: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Epoch ms of a wall-clock time in `tz`. `month` is 1-based.
 * Nonexistent times (DST gap) resolve forward; ambiguous ones take the earlier instant.
 */
export function wallTimeToMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  tz?: string,
): number {
  if (!tz) return new Date(year, month - 1, day, hour, minute, second).getTime();
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  // Offsets on either side of any transition near this wall time.
  const before = offsetAt(guess - 86_400_000, tz);
  const after = offsetAt(guess + 86_400_000, tz);
  const valid = [before, after].map((o) => guess - o).filter((t) => guess - t === offsetAt(t, tz));
  if (valid.length) return Math.min(...valid);
  // DST gap: interpret with the pre-transition offset, which lands just after the gap.
  return guess - before;
}

/** Local midnight of a calendar date (1-based month) in `tz`. */
export function midnightMs(year: number, month: number, day: number, tz?: string): number {
  return wallTimeToMs(year, month, day, 0, 0, 0, tz);
}

/** Parse "YYYY-MM-DD" into local midnight in `tz`. */
export function dateStringToMidnight(date: string, tz?: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  return midnightMs(Number(m[1]), Number(m[2]), Number(m[3]), tz);
}
