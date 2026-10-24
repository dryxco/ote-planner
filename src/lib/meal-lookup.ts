"use client";

import { useSync } from "./store";
import { estimate } from "./meal-photos";

/** Dishes being looked up right now ("meal id|name"), and ones tried this session (not tried again on every render). */
export const estimating = new Set<string>();
export const tried = new Set<string>();

/** A dish typed in by hand: its amount and calories looked up and filled in (it stays "added"). */
export async function estimateDish(mealId: string, name: string, onChange: () => void = () => {}, query = name) {
  const key = `${mealId}|${name}`;
  if (estimating.has(key)) return;
  estimating.add(key);
  tried.add(key);
  onChange();
  try {
    const d = await estimate(query);
    const { meals, updateMeal } = useSync.getState();
    const m = meals.find((x) => x.id === mealId);
    if (!m) return;
    // the dish may have moved or been renamed meanwhile: fill in the one that still has this name
    const i = m.dishes.findIndex((x) => x.name === name && x.kcal === null);
    if (i < 0) return;
    // a typed-in dish stays one; a photo dish someone renamed stays a photo one
    const added = m.dishes[i].added;
    updateMeal(mealId, { dishes: m.dishes.map((x, j) => (j === i ? { name, amount: d.amount, kcal: d.kcal, basis: d.basis, ...(added ? { added: true } : {}) } : x)) });
  } catch {
    // leaves it without calories; typing them in still works
  } finally {
    estimating.delete(key);
    onChange();
  }
}

