/**
 * The food dictionary: per-100g calories (and the weight of one piece, for packaged snacks) of every food
 * read so far, kept by name. A food read again takes its figures from here, and its calories are worked
 * out in code (per 100g × grams) instead of taken from Claude's own sum, so the same dish gets the same
 * number every time and a serving can't be mistaken for one piece.
 */

export interface Food {
  /** The name it was first read under (later readings take this name too). */
  name: string;
  /** kcal per 100g. */
  per100g: number;
  /** The weight of one piece (one wrapped cookie, one egg), when it comes in pieces. */
  pieceGrams?: number;
  /** Where the figures come from, short ("해태 영양성분표", "식약처 DB"). */
  source?: string;
  at: number;
}

/** A dish as Claude reads it: its own sum (`kcal`) plus the figures it worked from. */
export interface RawDish {
  name?: unknown;
  amount?: unknown;
  kcal?: unknown;
  basis?: unknown;
  per100g?: unknown;
  grams?: unknown;
  pieces?: unknown;
  pieceGrams?: unknown;
  source?: unknown;
}

/** One key for the ways a name gets written: spacing, case and punctuation don't count ("버터링 딥초코" = "버터링딥초코"). */
export function foodKey(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s·.,'"!?~\-_/()[\]]+/g, "");
}

const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : undefined);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/**
 * A dish with its calories worked out: the dictionary's figures win over the fresh ones (so the number
 * doesn't move between readings), grams = pieces × one piece's weight when it comes in pieces, and
 * kcal = per 100g × grams. Without enough figures, Claude's own number stays.
 */
export function resolveDish(raw: RawDish, dict: Record<string, Food>): RawDish {
  const name = str(raw.name, 80);
  if (!name) return raw;
  const known = dict[foodKey(name)];
  const per100g = known?.per100g ?? num(raw.per100g, 900);
  const pieceGrams = known?.pieceGrams ?? num(raw.pieceGrams, 2000);
  const pieces = num(raw.pieces, 100);
  const grams = pieces && pieceGrams ? pieces * pieceGrams : num(raw.grams, 5000);
  if (!per100g || !grams) return known ? { ...raw, name: known.name } : raw;
  const kcal = Math.round((per100g * grams) / 100);
  const source = known?.source ?? str(raw.source, 40);
  const weight = pieces && pieceGrams ? `${pieces === 1 ? "" : `${fmt(pieces)}개 × `}낱개 ${fmt(pieceGrams)}g` : `${fmt(grams)}g`;
  let amount = str(raw.amount, 40);
  // the grams shown follow the grams counted
  if (amount && /\([\d.]+\s*g\)/.test(amount)) amount = amount.replace(/\([\d.]+\s*g\)/, `(${fmt(grams)}g)`);
  else amount = amount ? `${amount} (${fmt(grams)}g)` : `${fmt(grams)}g`;
  return {
    name: known?.name ?? name,
    amount,
    kcal,
    basis: `${source ? `${source} ` : ""}100g당 ${fmt(per100g)}kcal × ${weight} = ${kcal}kcal`,
  };
}

/** New dictionary entries from a reading: foods not in it yet that came with a per-100g figure. */
export function learnFoods(raws: RawDish[], dict: Record<string, Food>, now: number): Record<string, Food> {
  const out: Record<string, Food> = {};
  for (const r of raws) {
    const name = str(r.name, 80);
    const per100g = num(r.per100g, 900);
    if (!name || !per100g) continue;
    const key = foodKey(name);
    if (!key || dict[key] || out[key]) continue;
    const food: Food = { name, per100g, at: now };
    const pieceGrams = num(r.pieceGrams, 2000);
    const source = str(r.source, 40);
    if (pieceGrams) food.pieceGrams = pieceGrams;
    if (source) food.source = source;
    out[key] = food;
  }
  return out;
}

/** The dictionary as told to Claude: the newest foods first, one per line (names to reuse, figures not to look up again). */
export function foodsForPrompt(dict: Record<string, Food>, max = 150): string {
  return Object.values(dict)
    .sort((a, b) => b.at - a.at)
    .slice(0, max)
    .map((f) => `${f.name}: 100g당 ${fmt(f.per100g)}kcal${f.pieceGrams ? `, 낱개 ${fmt(f.pieceGrams)}g` : ""}`)
    .join("\n");
}
