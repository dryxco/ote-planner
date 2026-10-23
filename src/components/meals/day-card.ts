"use client";

import type { Meal, MealKind } from "@/lib/types";
import { MEAL_KINDS, mealKcal } from "@/lib/meals";

/**
 * One picture of a day's meals to share (KakaoTalk, save to Photos): the date and the day's calories on
 * top, then breakfast / lunch / dinner / snack as four tiles, each its first photo with what was in it.
 */
const W = 1080;
const PAD = 48;
const GAP = 24;
const TILE = (W - PAD * 2 - GAP) / 2;
const PHOTO_H = 380;
const TILE_H = PHOTO_H + 200;
const TOP = 210;
const H = TOP + TILE_H * 2 + GAP + 110;

const SLOTS: { kind: MealKind; label: string; color: string }[] = MEAL_KINDS.map((k) => ({ kind: k.id, label: k.ko, color: k.color }));
/** Warm paper and ink: the photos carry the colour, each meal only a small mark of its own. */
const PAPER = "#f3efe8";
const INK = "#24211c";
const INK_2 = "#6f6a61";
const INK_3 = "#a9a398";
const EMPTY = "#e9e3d9";
const FONT = `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif`;
const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

async function load(url: string): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Text cut to fit `w` with an ellipsis. */
function fit(g: CanvasRenderingContext2D, s: string, w: number): string {
  if (g.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 1 && g.measureText(`${t}…`).width > w) t = t.slice(0, -1);
  return `${t}…`;
}

export async function dayCard(date: number, meals: Meal[]): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);

  const d = new Date(date);
  const total = meals.reduce((s, m) => s + (mealKcal(m) ?? 0), 0);
  g.fillStyle = INK;
  g.font = `700 64px ${FONT}`;
  g.textBaseline = "alphabetic";
  g.fillText(`${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`, PAD, 120);
  g.fillStyle = INK_2;
  g.font = `500 32px ${FONT}`;
  g.fillText(total ? `하루 약 ${total.toLocaleString()} kcal` : "오늘의 식단", PAD, 172);

  for (let i = 0; i < SLOTS.length; i++) {
    const s = SLOTS[i];
    const x = PAD + (i % 2) * (TILE + GAP);
    const y = TOP + Math.floor(i / 2) * (TILE_H + GAP);
    const mine = meals.filter((m) => m.kind === s.kind);
    g.save();
    roundRect(g, x, y, TILE, TILE_H, 28);
    g.fillStyle = "#fffdf9";
    g.fill();
    g.clip();
    // the photo: its first meal's first photo, cropped to fill
    const bmp = mine[0]?.photos[0] ? await load(mine[0].photos[0]) : null;
    if (bmp) {
      const k = Math.max(TILE / bmp.width, PHOTO_H / bmp.height);
      const w = bmp.width * k;
      const h = bmp.height * k;
      g.drawImage(bmp, x + (TILE - w) / 2, y + (PHOTO_H - h) / 2, w, h);
      bmp.close();
    } else {
      g.fillStyle = EMPTY;
      g.fillRect(x, y, TILE, PHOTO_H);
      g.fillStyle = INK_3;
      g.font = `500 30px ${FONT}`;
      g.textAlign = "center";
      g.fillText(mine.length ? "사진 없음" : "—", x + TILE / 2, y + PHOTO_H / 2 + 10);
      g.textAlign = "left";
    }
    g.restore();

    // label, calories, then what was in it
    const ty = y + PHOTO_H + 58;
    // the meal's own mark: a small dot before its name
    g.fillStyle = s.color;
    g.beginPath();
    g.arc(x + 36, ty - 12, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK;
    g.font = `700 36px ${FONT}`;
    g.fillText(s.label, x + 56, ty);
    const kcal = mine.reduce((sum, m) => sum + (mealKcal(m) ?? 0), 0);
    if (kcal) {
      g.fillStyle = INK_2;
      g.font = `600 28px ${FONT}`;
      g.textAlign = "right";
      g.fillText(`${kcal.toLocaleString()} kcal`, x + TILE - 28, ty);
      g.textAlign = "left";
    }
    const names = mine.flatMap((m) => m.dishes.map((dd) => dd.name));
    g.fillStyle = mine.length ? INK_2 : INK_3;
    g.font = `400 28px ${FONT}`;
    const lines = names.length ? [names.slice(0, 3).join(", "), names.length > 3 ? names.slice(3).join(", ") : ""] : [mine.length ? "" : "기록 없음"];
    lines.filter(Boolean).slice(0, 2).forEach((line, li) => g.fillText(fit(g, line, TILE - 56), x + 28, ty + 50 + li * 40));
  }

  g.fillStyle = INK_3;
  g.font = `500 24px ${FONT}`;
  g.textAlign = "right";
  g.fillText("Ote", W - PAD, H - 44);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't make the picture"))), "image/png"));
}
