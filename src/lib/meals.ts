import type { Meal, MealKind } from "./types";
import { logicalDate } from "./time";

export const MEAL_KINDS: { id: MealKind; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
];

/** The meal a time of day most likely is: breakfast 5–10:30, lunch –15:00, snack –17:00, dinner –21:30, else a snack. */
export function kindAt(t: number): MealKind {
  const d = new Date(t);
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= 5 * 60 && m < 10 * 60 + 30) return "breakfast";
  if (m >= 10 * 60 + 30 && m < 15 * 60) return "lunch";
  if (m >= 15 * 60 && m < 17 * 60) return "snack";
  if (m >= 17 * 60 && m < 21 * 60 + 30) return "dinner";
  return "snack";
}

/** A day's meals (by the planner's day, which may start after midnight), earliest first. */
export function mealsOn(all: Meal[], date: number, dayStart: number): Meal[] {
  return all.filter((m) => logicalDate(m.at, dayStart) === date).sort((a, b) => a.at - b.at || a.createdAt - b.createdAt);
}

/** A meal's calories (null when none of its dishes has a number). */
export function mealKcal(m: Meal): number | null {
  const ks = m.dishes.map((d) => d.kcal).filter((k): k is number => typeof k === "number");
  return ks.length ? ks.reduce((a, b) => a + b, 0) : null;
}

/** A day's calories. */
export const dayKcal = (meals: Meal[]) => meals.reduce((sum, m) => sum + (mealKcal(m) ?? 0), 0);

/** What Claude said about the photos, cleaned up (names trimmed and capped, calories whole and sane). */
export function cleanDishes(raw: unknown): { name: string; kcal: number | null }[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((d) => {
      const o = (d ?? {}) as { name?: unknown; kcal?: unknown };
      const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
      const k = typeof o.kcal === "number" && Number.isFinite(o.kcal) ? Math.round(o.kcal) : null;
      return { name, kcal: k !== null && k >= 0 && k <= 5000 ? k : null };
    })
    .filter((d) => d.name)
    .slice(0, 20);
}

/** Photos taken within this long of each other are the same meal. */
export const SAME_MEAL_MS = 45 * 60_000;

/** Photos picked together, split into meals by when they were taken (each meal earliest first, up to 4 photos). */
export function groupByTime<T extends { at: number }>(photos: T[], max = 4): T[][] {
  const sorted = [...photos].sort((a, b) => a.at - b.at);
  const out: T[][] = [];
  for (const p of sorted) {
    const cur = out.at(-1);
    if (cur && p.at - cur[cur.length - 1].at <= SAME_MEAL_MS && cur.length < max) cur.push(p);
    else out.push([p]);
  }
  return out;
}

/** When a photo picked for `date` was eaten: its own time if it's from that day, else that day at the current time of day. */
export function timeOn(photoAt: number, date: number, dayStart: number, now: number): number {
  if (logicalDate(photoAt, dayStart) === date) return photoAt;
  const d = new Date(now);
  const t = new Date(date);
  t.setHours(d.getHours(), d.getMinutes(), 0, 0);
  // a time before the day's start belongs to the next calendar day
  return logicalDate(t.getTime(), dayStart) === date ? t.getTime() : t.getTime() + 86_400_000;
}
