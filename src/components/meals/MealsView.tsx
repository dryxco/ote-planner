"use client";

import { useEffect, useRef, useState } from "react";
import type { Meal, MealKind } from "@/lib/types";
import { useSync } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { useIsDesktop } from "@/lib/media";
import { WEEKDAY_SHORT, addDays, logicalDate, pad2 } from "@/lib/time";
import { MEAL_KINDS, dayKcal, groupByTime, kindAt, kindColor, mealKcal, mealsOn, timeOn } from "@/lib/meals";
import { readPhotos, uploadPhoto } from "@/lib/meal-photos";
import { ChevronLeft, ChevronRight, PlusIcon, XIcon } from "../icons";
import { TabHeader } from "../period";
import { cx } from "../ui";
import { dayCard } from "./day-card";

const images = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));

/** Said when the reading never reached the server (the phone dropped it): it's tried again by itself. */
export const OFFLINE = "Couldn't reach the server — trying again when you're back";
/** A reading still "reading" this long after its last change was cut off (the page closed mid-way). */
const STALE_READING_MS = 2 * 60_000;
const reading = new Set<string>();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read (or read again) what's in a meal from its photos; the dishes land in the meal as it syncs.
 * A dropped request (iOS cuts fetches off when the camera or another app takes over, or the screen
 * locks: Safari says only "Load failed") is retried twice, then again when the page is back.
 */
async function readMeal(id: string) {
  const { meals, updateMeal } = useSync.getState();
  const m = meals.find((x) => x.id === id);
  if (!m?.photos.length || reading.has(id)) return;
  reading.add(id);
  updateMeal(id, { status: "reading", error: undefined });
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await readPhotos(m.photos);
        updateMeal(id, { dishes: r.dishes, status: "done", error: r.dishes.length ? undefined : (r.note ?? "No food found in the photos") });
        return;
      } catch (e) {
        // a TypeError is the network (no answer at all); anything else is the server's own reason
        const dropped = e instanceof TypeError;
        if (dropped && attempt < 2) {
          await wait(1500 * (attempt + 1));
          continue;
        }
        updateMeal(id, { status: "failed", error: dropped ? OFFLINE : (e as Error).message });
        return;
      }
    }
  } finally {
    reading.delete(id);
  }
}

/** Readings that were cut off (dropped, or left "reading" by a closed page): read again. */
export function resumeReadings(now = Date.now()) {
  for (const m of useSync.getState().meals ?? []) {
    if (!m.photos.length || reading.has(m.id)) continue;
    const cut = (m.status === "failed" && m.error === OFFLINE) || (m.status === "reading" && now - m.updatedAt > STALE_READING_MS);
    if (cut) void readMeal(m.id);
  }
}

/** New meals from photos picked for `date` (split by when they were taken), or more photos for one meal. */
async function addPhotos(files: File[], date: number, into?: string) {
  const { addMeal, updateMeal, settings } = useSync.getState();
  if (into) {
    const m = useSync.getState().meals.find((x) => x.id === into);
    if (!m) return;
    updateMeal(into, { status: "reading", error: undefined });
    try {
      const urls = await Promise.all(files.slice(0, Math.max(0, 4 - m.photos.length)).map(uploadPhoto));
      updateMeal(into, { photos: [...(useSync.getState().meals.find((x) => x.id === into)?.photos ?? []), ...urls] });
      await readMeal(into);
    } catch (e) {
      updateMeal(into, { status: "failed", error: (e as Error).message });
    }
    return;
  }
  const groups = groupByTime(files.map((f) => ({ f, at: f.lastModified || Date.now() })));
  await Promise.all(
    groups.map(async (g) => {
      const at = timeOn(g[0].at, date, settings.dayStart, Date.now());
      const id = addMeal({ at, kind: kindAt(at), photos: [], dishes: [], status: "reading" });
      try {
        const urls = await Promise.all(g.map((x) => uploadPhoto(x.f)));
        updateMeal(id, { photos: urls });
        await readMeal(id);
      } catch (e) {
        updateMeal(id, { status: "failed", error: (e as Error).message });
      }
    }),
  );
}

/**
 * The Meals tab: a day's meals from photos. Take one with the camera or pick from Photos; what's in it
 * (and rough calories) is read from the photos and filled in, and can be fixed by hand. Share makes one
 * picture of the day (breakfast, lunch, dinner, snack) for KakaoTalk or Photos.
 */
export function MealsView() {
  const now = useNow(60_000);
  const dayStart = useSync((s) => s.settings.dayStart);
  const all = useSync((s) => s.meals) ?? [];
  const desktop = useIsDesktop();
  const today = logicalDate(now, dayStart);
  // null = today, whatever day that is now (an open page past midnight moves on to the new day)
  const [picked, setPicked] = useState<number | null>(null);
  const date = picked ?? today;
  const setDate = (d: number) => setPicked(d === today ? null : d);
  // cut-off readings go again on opening the tab and whenever the page is back in front
  useEffect(() => {
    resumeReadings();
    const back = () => document.visibilityState === "visible" && resumeReadings();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("online", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("online", back);
    };
  }, []);
  const meals = mealsOn(all, date, dayStart);
  const total = dayKcal(meals);
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  const [share, setShare] = useState(false);
  const d = new Date(date);
  const label = date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : `${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY_SHORT[d.getDay()]}`;
  const pick = (list: FileList | null) => {
    const files = images(list);
    if (files.length) void addPhotos(files, date);
  };

  return (
    <div data-meals-view className="flex h-full flex-col pt-[max(8px,env(safe-area-inset-top))]">
      <TabHeader
        title="Meals"
        right={
          <button
            data-share-day
            disabled={!meals.length}
            onClick={() => setShare(true)}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-fg/60 ring-1 ring-fg/15 hover:bg-fg/[0.06] hover:text-fg disabled:opacity-35"
          >
            <ShareGlyph />
            Share
          </button>
        }
      />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--tabbar-h)+48px)] pt-1">
        <div className="mx-auto max-w-[640px]">
          <div className="mb-3 flex items-center justify-center gap-2">
            <button aria-label="Day before" onClick={() => setDate(addDays(date, -1))} className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-fg/55 hover:bg-fg/[0.07]">
              <ChevronLeft size={14} />
            </button>
            <button data-meals-date onClick={() => setDate(today)} className="min-w-[120px] text-center text-[14px] font-medium" title="Back to today">
              {label}
            </button>
            <button aria-label="Day after" disabled={date >= today} onClick={() => setDate(addDays(date, 1))} className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-fg/55 hover:bg-fg/[0.07] disabled:opacity-30">
              <ChevronRight size={14} />
            </button>
          </div>
          <p data-day-kcal className="mb-4 text-center text-[12.5px] text-fg/50 tabular">
            {meals.length ? `${meals.length} meal${meals.length > 1 ? "s" : ""}${total ? ` · about ${total.toLocaleString()} kcal` : ""}` : "Nothing logged yet"}
          </p>

          {/* the camera opens straight away on phones; Photos picks one or more (split into meals by time) */}
          <div className="mb-5 grid grid-cols-2 gap-2">
            {!desktop && (
              <button data-meal-camera onClick={() => camera.current?.click()} className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] bg-charcoal text-[15px] font-semibold text-on-charcoal active:opacity-80">
                <CameraGlyph />
                Take photo
              </button>
            )}
            <button
              data-meal-album
              onClick={() => album.current?.click()}
              className={cx("flex h-[52px] items-center justify-center gap-2 rounded-[14px] text-[15px] font-medium", desktop ? "col-span-2 bg-charcoal text-on-charcoal hover:opacity-90" : "bg-surface text-fg ring-1 ring-fg/10")}
            >
              <PhotosGlyph />
              {desktop ? "Add meal photos" : "From Photos"}
            </button>
          </div>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden data-meal-camera-input onChange={(e) => (pick(e.currentTarget.files), (e.currentTarget.value = ""))} />
          <input ref={album} type="file" accept="image/*" multiple hidden data-meal-album-input onChange={(e) => (pick(e.currentTarget.files), (e.currentTarget.value = ""))} />

          <div className="flex flex-col gap-3">
            {meals.map((m) => (
              <MealCard key={m.id} m={m} date={date} />
            ))}
          </div>
          {!meals.length && <p className="py-10 text-center text-[13px] text-fg/40">Take a photo of what you eat — what&apos;s in it is filled in for you.</p>}
        </div>
      </div>
      {share && <ShareSheet date={date} meals={meals} onClose={() => setShare(false)} />}
    </div>
  );
}

function MealCard({ m, date }: { m: Meal; date: number }) {
  const { updateMeal, deleteMeal } = useSync.getState();
  const more = useRef<HTMLInputElement>(null);
  const [armed, setArmed] = useState(false);
  const [big, setBig] = useState<string | null>(null);
  const kcal = mealKcal(m);
  const t = new Date(m.at);
  const setDishes = (dishes: Meal["dishes"]) => updateMeal(m.id, { dishes });
  return (
    <section data-meal={m.id} className="relative overflow-hidden rounded-[16px] bg-surface p-3 pl-4 ring-1 ring-fg/[0.06]">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: kindColor(m.kind) }} />
      <div className="mb-2.5 flex items-center gap-2">
        <select
          data-meal-kind
          aria-label="Meal"
          value={m.kind}
          onChange={(e) => updateMeal(m.id, { kind: e.target.value as MealKind })}
          style={{ color: kindColor(m.kind), background: `color-mix(in srgb, ${kindColor(m.kind)} 14%, transparent)` }}
          className="appearance-none rounded-full px-3 py-1 text-[13px] font-semibold outline-none"
        >
          {MEAL_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          type="time"
          aria-label="Time"
          value={`${pad2(t.getHours())}:${pad2(t.getMinutes())}`}
          onChange={(e) => {
            const [h, mi] = e.target.value.split(":").map(Number);
            if (Number.isNaN(h) || Number.isNaN(mi)) return;
            const n = new Date(m.at);
            n.setHours(h, mi, 0, 0);
            updateMeal(m.id, { at: n.getTime() });
          }}
          className="bg-transparent text-[13px] text-fg/55 outline-none tabular"
        />
        <span data-meal-kcal className="ml-auto text-[13px] font-semibold text-fg/80 tabular">
          {kcal !== null ? `${kcal.toLocaleString()} kcal` : ""}
        </span>
        {armed ? (
          <button data-meal-delete-confirm onClick={() => deleteMeal(m.id)} className="rounded-full bg-[#ff453a] px-2.5 py-0.5 text-[12px] font-semibold text-white">
            Delete
          </button>
        ) : (
          <button aria-label="Delete meal" onClick={() => setArmed(true)} onBlur={() => setTimeout(() => setArmed(false), 200)} className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-fg/40 hover:bg-fg/[0.07] hover:text-fg">
            <XIcon size={12} />
          </button>
        )}
      </div>

      <div className="no-scrollbar mb-2.5 flex gap-2 overflow-x-auto">
        {m.photos.map((p) => (
          <div key={p} className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p} alt="" onClick={() => setBig(p)} className="h-[96px] w-[96px] cursor-zoom-in rounded-[12px] object-cover" />
            <button
              aria-label="Remove photo"
              onClick={() => updateMeal(m.id, { photos: m.photos.filter((x) => x !== p) })}
              className="absolute right-1 top-1 flex h-[20px] w-[20px] items-center justify-center rounded-full bg-black/55 text-white"
            >
              <XIcon size={9} />
            </button>
          </div>
        ))}
        {m.status === "reading" && !m.photos.length && <div className="h-[96px] w-[96px] shrink-0 animate-pulse rounded-[12px] bg-fg/[0.07]" />}
        {m.photos.length < 4 && (
          <button data-meal-more aria-label="Add photos" onClick={() => more.current?.click()} className="flex h-[96px] w-[64px] shrink-0 items-center justify-center rounded-[12px] border border-dashed border-fg/20 text-fg/40 hover:text-fg">
            <PlusIcon size={16} />
          </button>
        )}
        <input
          ref={more}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = images(e.currentTarget.files);
            e.currentTarget.value = "";
            if (files.length) void addPhotos(files, date, m.id);
          }}
        />
      </div>

      {m.status === "reading" ? (
        <p data-meal-reading className="animate-pulse px-1 py-1 text-[13px] text-fg/50">
          Reading the photos…
        </p>
      ) : (
        <>
          <ul className="flex flex-col">
            {m.dishes.map((dd, i) => (
              <li key={i} data-dish className="flex items-center gap-2 border-b border-fg/[0.06] py-1 last:border-b-0">
                <DishField value={dd.name} label="Dish" className="min-w-0 flex-1" onCommit={(v) => setDishes(v.trim() ? m.dishes.map((x, j) => (j === i ? { ...x, name: v.trim() } : x)) : m.dishes.filter((_, j) => j !== i))} />
                <DishField
                  value={dd.kcal === null ? "" : String(dd.kcal)}
                  label="Calories"
                  numeric
                  className="w-[64px] text-right"
                  onCommit={(v) => {
                    const n = v.trim() === "" ? null : Math.max(0, Math.round(Number(v)));
                    if (n !== null && Number.isNaN(n)) return;
                    setDishes(m.dishes.map((x, j) => (j === i ? { ...x, kcal: n } : x)));
                  }}
                />
                <span className="text-[12px] text-fg/40">kcal</span>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex items-center gap-3 px-1">
            <button data-add-dish onClick={() => setDishes([...m.dishes, { name: "New dish", kcal: null }])} className="text-[12.5px] font-medium text-fg/65 hover:text-fg">
              + Dish
            </button>
            {m.photos.length > 0 && (
              <button data-meal-reread onClick={() => void readMeal(m.id)} className="text-[12.5px] text-fg/45 hover:text-fg">
                Read again
              </button>
            )}
            {m.error && (
              <span data-meal-error className={cx("min-w-0 truncate text-[12px]", m.status === "failed" ? "text-danger-soft" : "text-fg/45")}>
                {m.error}
              </span>
            )}
          </div>
        </>
      )}
      {big && (
        <div className="animate-fade fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" onClick={() => setBig(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={big} alt="" className="max-h-full max-w-full rounded-[12px] object-contain" />
        </div>
      )}
    </section>
  );
}

/** A dish's name or calories, edited in place (written on Enter or when leaving the field). */
function DishField({ value, label, numeric, className, onCommit }: { value: string; label: string; numeric?: boolean; className?: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setV(value);
  }, [value]);
  return (
    <input
      aria-label={label}
      value={v}
      inputMode={numeric ? "numeric" : undefined}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={() => v !== value && onCommit(v)}
      className={cx("bg-transparent py-0.5 text-[14px] outline-none tabular focus:text-fg", className)}
    />
  );
}

/** The day as one picture: share it (KakaoTalk, Messages…) or save it. */
function ShareSheet({ date, meals, onClose }: { date: number; meals: Meal[]; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(meals.map((m) => [m.id, m.updatedAt]));
  useEffect(() => {
    let gone = false;
    let made: string | null = null;
    const d = new Date(date);
    dayCard(date, meals)
      .then((b) => {
        if (gone) return;
        made = URL.createObjectURL(b);
        setUrl(made);
        setFile(new File([b], `meals-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.png`, { type: "image/png" }));
      })
      .catch((e) => !gone && setError((e as Error).message));
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, key]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  const save = () => {
    if (!url || !file) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
  };
  return (
    <div data-share-sheet className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="animate-fade absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="animate-sheet relative flex max-h-[92dvh] w-full max-w-[440px] flex-col gap-3 rounded-t-[22px] bg-surface p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[22px]">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Share the day</h2>
          <button aria-label="Close" onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-fg/55 hover:bg-fg/[0.07]">
            <XIcon size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-[14px] bg-fg/[0.04]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img data-share-preview src={url} alt="The day's meals" className="w-full" /> : <div className="aspect-[1080/1504] animate-pulse" />}
        </div>
        {error && <p className="text-[12.5px] text-danger-soft">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button data-share-save disabled={!url} onClick={save} className="h-[46px] rounded-[12px] bg-fg/[0.07] text-[15px] font-medium disabled:opacity-40">
            Save image
          </button>
          <button
            data-share-send
            disabled={!file}
            onClick={() => {
              if (!file) return;
              // the phone's share sheet (KakaoTalk, Messages, Save Image…); computers without one save it
              if (canShare) navigator.share({ files: [file] }).catch(() => {});
              else save();
            }}
            className="h-[46px] rounded-[12px] bg-charcoal text-[15px] font-semibold text-on-charcoal disabled:opacity-40"
          >
            {canShare ? "Share…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}

const glyph = (d: string) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const CameraGlyph = () => glyph("M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z");
const PhotosGlyph = () => glyph("M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17.5M15.5 9.5h.01");
const ShareGlyph = () => glyph("M12 15V4M8 8l4-4 4 4M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7");
