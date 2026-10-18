// Date/time helpers. A "logical day" runs from settings.dayStart on its date
// until settings.dayStart on the next date (24h); dayClose marks where the
// day is considered closed (later times are dimmed in the timeline).

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function addMonths(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return d.getTime();
}

export function startOfWeek(t: number, weekStartsOn: number): number {
  const d = new Date(startOfDay(t));
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export function startOfMonth(t: number): number {
  const d = new Date(startOfDay(t));
  d.setDate(1);
  return d.getTime();
}

export function startOfYear(t: number): number {
  const d = new Date(startOfDay(t));
  d.setMonth(0, 1);
  return d.getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** The calendar date (midnight) whose logical day contains t. */
export function logicalDate(t: number, dayStartMin: number): number {
  return startOfDay(t - dayStartMin * MIN);
}

/** [start, end) of the logical day for a calendar date (midnight ms). */
export function logicalDayRange(date: number, dayStartMin: number): [number, number] {
  const start = date + dayStartMin * MIN;
  // use addDays to stay correct across DST changes
  return [start, addDays(date, 1) + dayStartMin * MIN];
}

export function minutesOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function fmtTime(t: number): string {
  const d = new Date(t);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtTime24(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtMinutesOfDay(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m % 60)} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtDuration(ms: number): string {
  const total = Math.round(ms / MIN);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function fmtMonthDay(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtDateShort(t: number): string {
  const d = new Date(t);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "Today", "Yesterday", "Tomorrow" or "Oct 7" relative to now. */
export function relativeDayLabel(t: number, now: number): string {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function toDateInput(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function toTimeInput(t: number): string {
  return fmtTime24(t);
}

/** Combine a yyyy-mm-dd and hh:mm into ms (local). */
export function fromInputs(date: string, time: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
}

export function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function roundTo(t: number, minutes: number): number {
  const step = minutes * MIN;
  return Math.round(t / step) * step;
}

export function floorTo(t: number, minutes: number): number {
  const step = minutes * MIN;
  const d = new Date(t);
  const off = (d.getHours() * 60 + d.getMinutes()) * MIN + d.getSeconds() * 1000 + d.getMilliseconds();
  return t - (off % step);
}
