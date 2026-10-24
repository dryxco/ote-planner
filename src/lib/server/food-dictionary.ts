import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "./store";
import type { Food } from "../food-dictionary";

/** The food dictionary on disk (.data/foods.json): foods by key (see foodKey). */
const file = () => path.join(dataDir(), "foods.json");

export async function loadFoods(): Promise<Record<string, Food>> {
  try {
    const v = JSON.parse(await fs.readFile(file(), "utf8")) as unknown;
    return v && typeof v === "object" ? (v as Record<string, Food>) : {};
  } catch {
    return {};
  }
}

let chain: Promise<unknown> = Promise.resolve();

/** Adds foods not in the dictionary yet (one that's already there keeps its figures). */
export function addFoods(add: Record<string, Food>): Promise<void> {
  if (!Object.keys(add).length) return Promise.resolve();
  const run = chain.then(async () => {
    const cur = await loadFoods();
    for (const [k, f] of Object.entries(add)) if (!cur[k]) cur[k] = f;
    await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 });
    const tmp = `${file()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(cur), { mode: 0o600 });
    await fs.rename(tmp, file());
  });
  chain = run.catch(() => {});
  return run;
}
