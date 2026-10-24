"use client";

import type { Meal, MealKind } from "@/lib/types";
import { MEAL_KINDS, mealKcal } from "@/lib/meals";

/**
 * One picture of a day's meals to share (KakaoTalk, save to Photos), drawn like the app's own light
 * screens: a grey page, white rounded cards, black / grey text, each meal's tinted name pill. The date
 * and the day's calories on top, then breakfast / lunch / dinner / snack, each its first photo and
 * what was in it (dish and kcal per line, like the meal card).
 */
const W = 1080;
const PAD = 48;
const GAP = 24;
const TILE = (W - PAD * 2 - GAP) / 2;
const PHOTO_H = 344;
/** Under the photo: the pill row, then up to three dish lines and the card's bottom padding. */
const ROW = 52;
const TILE_H = PHOTO_H + 28 + 104 + 2 * ROW + 40;
const TOP = 236;
const H = TOP + TILE_H * 2 + GAP + 104;
const R = 32;

const SLOTS: { kind: MealKind; label: string; color: string }[] = MEAL_KINDS.map((k) => ({ kind: k.id, label: k.ko, color: k.color }));
// the app's light theme (globals.css): --bg, --surface, --surface-0, text and its 55% / 28% greys
const BG = "#ebebeb";
const CARD = "#ffffff";
const EMPTY = "#f5f5f5";
const TEXT = "#000000";
const TEXT_2 = "rgba(0, 0, 0, 0.55)";
const TEXT_3 = "rgba(0, 0, 0, 0.28)";
const LINE = "rgba(0, 0, 0, 0.08)";
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif`;
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

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

/** A meal's name as the app draws it: a pill tinted with its colour, the name in that colour. */
function pill(g: CanvasRenderingContext2D, x: number, y: number, label: string, color: string) {
  g.font = `600 28px ${FONT}`;
  const w = g.measureText(label).width + 36;
  rounded(g, x, y, w, 48, 24);
  g.globalAlpha = 0.14;
  g.fillStyle = color;
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.fillText(label, x + 18, y + 34);
}

export async function dayCard(date: number, meals: Meal[]): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  g.textBaseline = "alphabetic";

  // the date (left) and the day's calories (right)
  const d = new Date(date);
  const total = meals.reduce((s, m) => s + (mealKcal(m) ?? 0), 0);
  g.fillStyle = TEXT_2;
  g.font = `500 30px ${FONT}`;
  g.fillText(`${d.getFullYear()} · ${WEEKDAY_KO[d.getDay()]}요일`, PAD, 104);
  g.fillStyle = TEXT;
  g.font = `700 68px ${FONT}`;
  g.fillText(`${d.getMonth() + 1}월 ${d.getDate()}일`, PAD, 180);
  if (total) {
    g.textAlign = "right";
    g.fillStyle = TEXT_2;
    g.font = `500 30px ${FONT}`;
    g.fillText("하루 약", W - PAD, 104);
    g.font = `600 32px ${FONT}`;
    const unitW = g.measureText(" kcal").width;
    g.fillStyle = TEXT_2;
    g.fillText(" kcal", W - PAD, 180);
    g.fillStyle = TEXT;
    g.font = `700 68px ${FONT}`;
    g.fillText(total.toLocaleString(), W - PAD - unitW, 180);
    g.textAlign = "left";
  }

  for (let i = 0; i < SLOTS.length; i++) {
    const s = SLOTS[i];
    const x = PAD + (i % 2) * (TILE + GAP);
    const y = TOP + Math.floor(i / 2) * (TILE_H + GAP);
    const mine = meals.filter((m) => m.kind === s.kind);
    // the card, its photo filling the top (cropped), like a meal card's thumbnail grown up
    g.save();
    rounded(g, x, y, TILE, TILE_H, R);
    g.fillStyle = CARD;
    g.fill();
    g.clip();
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
    }
    g.restore();

    // the meal's pill and its calories, then a dish per line (name left, kcal right)
    const ty = y + PHOTO_H + 28;
    pill(g, x + 28, ty, s.label, s.color);
    const kcal = mine.reduce((sum, m) => sum + (mealKcal(m) ?? 0), 0);
    if (kcal) {
      g.fillStyle = TEXT;
      g.font = `600 30px ${FONT}`;
      g.textAlign = "right";
      g.fillText(`${kcal.toLocaleString()} kcal`, x + TILE - 28, ty + 35);
      g.textAlign = "left";
    }
    const dishes = mine.flatMap((m) => m.dishes);
    if (!dishes.length) {
      g.fillStyle = TEXT_3;
      g.font = `400 28px ${FONT}`;
      g.fillText(mine.length ? "메뉴 없음" : "기록 없음", x + 28, ty + 112);
      continue;
    }
    const shown = dishes.length > 3 ? dishes.slice(0, 2) : dishes;
    shown.forEach((dd, li) => {
      const ly = ty + 104 + li * ROW;
      // a hairline midway between this line and the one above
      if (li > 0) {
        g.fillStyle = LINE;
        g.fillRect(x + 28, ly - ROW + 16, TILE - 56, 2);
      }
      g.font = `400 28px ${FONT}`;
      const k = dd.kcal !== null ? dd.kcal.toLocaleString() : "";
      const kw = k ? g.measureText(k).width + 16 : 0;
      g.fillStyle = TEXT;
      g.fillText(fit(g, dd.name, TILE - 56 - kw), x + 28, ly);
      if (k) {
        g.fillStyle = TEXT_2;
        g.textAlign = "right";
        g.fillText(k, x + TILE - 28, ly);
        g.textAlign = "left";
      }
    });
    if (dishes.length > 3) {
      g.fillStyle = TEXT_2;
      g.font = `400 26px ${FONT}`;
      g.fillText(`외 ${dishes.length - 2}개`, x + 28, ty + 104 + 2 * ROW);
    }
  }

  g.fillStyle = TEXT_3;
  g.font = `600 24px ${FONT}`;
  g.textAlign = "right";
  g.fillText("Ote", W - PAD, H - 44);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't make the picture"))), "image/png"));
}
