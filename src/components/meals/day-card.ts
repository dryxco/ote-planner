"use client";

import type { Meal, MealKind } from "@/lib/types";
import { MEAL_KINDS, mealKcal } from "@/lib/meals";

/**
 * One picture of a day's meals to share (KakaoTalk, save to Photos), drawn like the app's own light
 * screens: a grey page, white rounded cards, black / grey text, each meal's tinted name pill. The date
 * and the day's calories on top, then the day as a timeline: a rail on the left with each meal's time
 * and dot (spaced by how far apart the meals were), and on the right its card — its photo and every
 * dish with its kcal. The picture grows as long as the day needs, so nothing is cut off.
 */
const W = 1080;
const PAD = 48;
const TOP = 236;
const R = 32;
/** The rail: times right-aligned before it, cards after it. */
const TIME_R = PAD + 112;
const RAIL_X = PAD + 136;
const CARD_X = RAIL_X + 32;
const CARD_W = W - PAD - CARD_X;
const IN = 28;
const HEAD = 48;
const THUMB = 196;
const ROW = 50;
/** Between two meals: a base gap, plus more the longer apart they were (up to a cap). */
const GAP = 24;
const GAP_PER_HOUR = 28;
const GAP_MAX = 120;
const BOTTOM = 104;

const KINDS = new Map<MealKind, { label: string; color: string }>(MEAL_KINDS.map((k) => [k.id, { label: k.ko, color: k.color }]));
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

/** "08:43" */
const hm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** A meal's name as the app draws it: a pill tinted with its colour, the name in that colour (returns its width). */
function pill(g: CanvasRenderingContext2D, x: number, y: number, label: string, color: string): number {
  g.font = `600 28px ${FONT}`;
  const w = g.measureText(label).width + 36;
  rounded(g, x, y, w, 48, 24);
  g.globalAlpha = 0.14;
  g.fillStyle = color;
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.fillText(label, x + 18, y + 34);
  return w;
}

/** A meal card's height: its pill row, then the photo beside its dishes (whichever is taller). */
function cardHeight(m: Meal): number {
  const rows = Math.max(1, m.dishes.length) * ROW;
  return IN + HEAD + 20 + Math.max(m.photos.length ? THUMB : 0, rows) + IN - 8;
}

export async function dayCard(date: number, all: Meal[]): Promise<Blob> {
  const meals = [...all].sort((a, b) => a.at - b.at);
  // where each card goes: one under the other, further apart the longer between them
  const ys: number[] = [];
  let y = TOP;
  meals.forEach((m, i) => {
    if (i) y += GAP + Math.min(GAP_MAX, ((m.at - meals[i - 1].at) / 3_600_000) * GAP_PER_HOUR);
    ys.push(y);
    y += cardHeight(m);
  });
  const H = (meals.length ? y : TOP + 120) + BOTTOM;

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

  if (!meals.length) {
    g.fillStyle = TEXT_3;
    g.font = `400 30px ${FONT}`;
    g.fillText("기록 없음", PAD, TOP + 60);
  }

  // the rail, from the first meal's dot to the last's
  const dotY = (i: number) => ys[i] + IN + HEAD / 2;
  if (meals.length > 1) {
    g.fillStyle = LINE;
    g.fillRect(RAIL_X - 2, dotY(0), 4, dotY(meals.length - 1) - dotY(0));
  }

  for (let i = 0; i < meals.length; i++) {
    const m = meals[i];
    const kind = KINDS.get(m.kind) ?? { label: m.kind, color: "#888888" };
    const cy = ys[i];
    const ch = cardHeight(m);

    // its time and dot on the rail
    g.fillStyle = TEXT;
    g.font = `600 30px ${FONT}`;
    g.textAlign = "right";
    g.fillText(hm(m.at), TIME_R, dotY(i) + 11);
    g.textAlign = "left";
    g.beginPath();
    g.arc(RAIL_X, dotY(i), 11, 0, Math.PI * 2);
    g.fillStyle = BG;
    g.fill();
    g.beginPath();
    g.arc(RAIL_X, dotY(i), 8, 0, Math.PI * 2);
    g.fillStyle = kind.color;
    g.fill();

    // the card: the meal's pill and its calories
    rounded(g, CARD_X, cy, CARD_W, ch, R);
    g.fillStyle = CARD;
    g.fill();
    const ty = cy + IN;
    pill(g, CARD_X + IN, ty, kind.label, kind.color);
    const kcal = mealKcal(m);
    if (kcal) {
      g.fillStyle = TEXT;
      g.font = `600 30px ${FONT}`;
      g.textAlign = "right";
      g.fillText(`${kcal.toLocaleString()} kcal`, CARD_X + CARD_W - IN, ty + 35);
      g.textAlign = "left";
    }

    // its first photo (cropped square; how many more there are on it), then every dish beside it
    const by = ty + HEAD + 20;
    let lx = CARD_X + IN;
    if (m.photos.length) {
      const bmp = await load(m.photos[0]);
      g.save();
      rounded(g, lx, by, THUMB, THUMB, 20);
      g.clip();
      if (bmp) {
        const k = Math.max(THUMB / bmp.width, THUMB / bmp.height);
        const w = bmp.width * k;
        const h = bmp.height * k;
        g.drawImage(bmp, lx + (THUMB - w) / 2, by + (THUMB - h) / 2, w, h);
        bmp.close();
      } else {
        g.fillStyle = EMPTY;
        g.fillRect(lx, by, THUMB, THUMB);
      }
      if (m.photos.length > 1) {
        g.font = `600 24px ${FONT}`;
        const t = `+${m.photos.length - 1}`;
        const tw = g.measureText(t).width + 20;
        rounded(g, lx + THUMB - tw - 10, by + THUMB - 46, tw, 36, 18);
        g.fillStyle = "rgba(0, 0, 0, 0.55)";
        g.fill();
        g.fillStyle = "#ffffff";
        g.fillText(t, lx + THUMB - tw, by + THUMB - 19);
      }
      g.restore();
      lx += THUMB + 28;
    }
    const lw = CARD_X + CARD_W - IN - lx;
    if (!m.dishes.length) {
      g.fillStyle = TEXT_3;
      g.font = `400 28px ${FONT}`;
      g.fillText(m.status === "reading" ? "읽는 중" : "메뉴 없음", lx, by + 34);
      continue;
    }
    m.dishes.forEach((dd, li) => {
      const ly = by + 34 + li * ROW;
      // a hairline midway between this line and the one above
      if (li > 0) {
        g.fillStyle = LINE;
        g.fillRect(lx, ly - ROW + 14, lw, 2);
      }
      g.font = `400 28px ${FONT}`;
      const k = dd.kcal !== null ? dd.kcal.toLocaleString() : "";
      const kw = k ? g.measureText(k).width + 16 : 0;
      g.fillStyle = TEXT;
      g.fillText(fit(g, dd.name, lw - kw), lx, ly);
      if (k) {
        g.fillStyle = TEXT_2;
        g.textAlign = "right";
        g.fillText(k, lx + lw, ly);
        g.textAlign = "left";
      }
    });
  }

  g.fillStyle = TEXT_3;
  g.font = `600 24px ${FONT}`;
  g.textAlign = "right";
  g.fillText("Ote", W - PAD, H - 44);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't make the picture"))), "image/png"));
}
