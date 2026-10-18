"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { UndoKeys } from "./UndoKeys";
import { DiaryIcon, HomeIcon, InsightsIcon, PlannerIcon, ReviewIcon, StackIcon, SwatchIcon, TargetIcon, TodayIcon } from "./icons";
import { cx } from "./ui";
import { useHydrated, useNow } from "@/lib/hooks";
import { logicalDate } from "@/lib/time";
import { useSync } from "@/lib/store";
import { startSync, useSyncStatus } from "@/lib/sync-client";
import { useIsDesktop } from "@/lib/media";
import { useUI } from "@/lib/ui";
import { EntrySheet } from "./EntrySheet";
import { SettingsSheet } from "./SettingsSheet";
import { Reminders } from "./Reminders";

/** Computers: the three-pane Home first, then Today on its own like any other tab. */
const DESKTOP_TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/today", label: "Today", Icon: TodayIcon },
  { href: "/calendar", label: "Calendar", Icon: PlannerIcon },
  { href: "/projects", label: "Projects", Icon: StackIcon },
  { href: "/diary", label: "Diary", Icon: DiaryIcon },
];

/** Looking back rather than planning ahead: one "Insights" entry on phones, a group on the rail. */
const INSIGHTS = [
  { href: "/review", label: "Review", hint: "On time and done, over time", Icon: ReviewIcon },
  { href: "/activities", label: "Activities", hint: "What your time goes to", Icon: SwatchIcon },
  { href: "/goals", label: "Goals", hint: "Targets for the week or month", Icon: TargetIcon },
];

const TABS = [
  { href: "/", label: "Today", Icon: TodayIcon },
  { href: "/calendar", label: "Calendar", Icon: PlannerIcon },
  { href: "/projects", label: "Projects", Icon: StackIcon },
  { href: "/diary", label: "Diary", Icon: DiaryIcon },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function AppShell({ children }: { children: ReactNode }) {
  const desktop = useIsDesktop();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const entry = useUI((s) => s.entry);
  const settingsOpen = useUI((s) => s.settingsOpen);
  const setSettingsOpen = useUI((s) => s.setSettingsOpen);

  useEffect(() => {
    useSync.persist.rehydrate();
  }, []);

  // Device sync starts only after local data is loaded, so loading isn't mistaken for edits.
  useEffect(() => {
    if (hydrated) return startSync();
  }, [hydrated]);

  // OAuth callbacks land on "/?settings=1" — reopen Settings there.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("settings")) {
      setSettingsOpen(true);
      useUI.getState().setCalendarError(url.searchParams.get("calendarError"));
      url.searchParams.delete("settings");
      url.searchParams.delete("calendarError");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, [setSettingsOpen]);

  const sheets = (
    <>
      {hydrated && entry && <EntrySheet key={JSON.stringify(entry)} target={entry} />}
      {hydrated && settingsOpen && <SettingsSheet />}
      {hydrated && <Reminders />}
      {hydrated && <FollowToday />}
      {hydrated && <ReloadOnDeploy />}
      {hydrated && <UndoKeys />}
    </>
  );

  if (desktop) {
    // computers: side rail instead of the docked tab bar; Today becomes the three-pane home,
    // other tabs stay phone-width in the middle
    return (
      <div className="fixed inset-0 flex overflow-hidden bg-bg" style={{ ["--tabbar-h" as string]: "16px" }}>
        <SideRail />
        <main className="relative min-h-0 min-w-0 flex-1">
          {hydrated ? pathname === "/" ? children : <div className="relative mx-auto h-full max-w-[560px]">{children}</div> : null}
        </main>
        {sheets}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 mx-auto flex w-full max-w-[440px] flex-col overflow-hidden bg-bg">
      <main className="relative min-h-0 flex-1">{hydrated ? children : null}</main>
      <TabBar />
      {sheets}
    </div>
  );
}

function SideRail() {
  const pathname = usePathname();
  const item = ({ href, label, Icon }: (typeof DESKTOP_TABS)[number]) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative flex w-[62px] flex-col items-center gap-[5px] rounded-[10px] py-2 text-[10px] font-medium tracking-[0.01em]",
          active ? "bg-fg/[0.07] text-fg" : "text-fg/50 hover:bg-fg/[0.04] hover:text-fg/80",
        )}
      >
        {active && <span className="absolute -left-[7px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-now" />}
        <Icon size={20} />
        {label}
      </Link>
    );
  };
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-fg/[0.07] py-4">
      {/* the app icon, on the ground that matches the theme */}
      <span className="mb-3 block h-[40px] w-[40px]" title="Ote">
        {/* eslint-disable-next-line @next/next/no-img-element -- a 40px static icon */}
        <img src="/icons/icon-192.png" alt="Ote" width={40} height={40} className="h-full w-full rounded-[11px] [[data-theme=light]_&]:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element -- a 40px static icon */}
        <img src="/icons/icon-light-192.png" alt="Ote" width={40} height={40} className="hidden h-full w-full rounded-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)] [[data-theme=light]_&]:block" />
      </span>
      {DESKTOP_TABS.map(item)}
      <span className="mb-1 mt-4 text-[9px] font-semibold uppercase tracking-[0.12em] text-fg/35">Insights</span>
      {INSIGHTS.map(item)}
    </nav>
  );
}

/** Phones: a bar docked to the bottom edge. Insights opens a small menu of Review, Activities and Goals. */
function TabBar() {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const insights = INSIGHTS.some((t) => isActive(pathname, t.href));
  const slot = (active: boolean) =>
    cx("relative flex flex-1 flex-col items-center justify-center gap-[4px] text-[10px] font-medium tracking-[0.01em] transition-colors", active ? "text-fg" : "text-fg/45");
  const mark = <span className="absolute left-1/2 top-0 h-[2.5px] w-6 -translate-x-1/2 rounded-b-full bg-now" />;
  return (
    <>
      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
          <div data-insights-menu className="animate-fade absolute bottom-[calc(var(--tabbar-h)+8px)] right-3 z-40 w-[250px] overflow-hidden rounded-[14px] border border-fg/10 bg-surface p-1 shadow-2xl">
            {INSIGHTS.map(({ href, label, hint, Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenu(false)}
                className={cx("flex items-center gap-3 rounded-[10px] px-3 py-2.5", isActive(pathname, href) ? "bg-fg/[0.07]" : "hover:bg-fg/[0.04]")}
              >
                <Icon size={20} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{label}</span>
                  <span className="block truncate text-[11px] text-fg/50">{hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
      <nav className="absolute inset-x-0 bottom-0 z-30 flex h-[var(--tabbar-h)] items-start border-t border-fg/[0.08] bg-nav pb-[max(6px,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className="flex h-[56px] w-full items-stretch">
          {TABS.map(({ href, label, Icon }) => {
            const active = href === "/" ? pathname === "/" || pathname === "/today" : isActive(pathname, href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className={slot(active)}>
                {active && mark}
                <Icon size={22} />
                {label}
              </Link>
            );
          })}
          <button aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((v) => !v)} className={slot(insights || menu)}>
            {insights && mark}
            <InsightsIcon size={22} />
            Insights
          </button>
        </div>
      </nav>
    </>
  );
}

/**
 * Follow the real calendar: land on the logical today once loaded, and when the day rolls over
 * (at the Day start time, e.g. 05:00) move along — unless another date was picked on purpose.
 * Mounted only on the client (reads the clock).
 */
function FollowToday() {
  const dayStart = useSync((s) => s.settings.dayStart);
  const today = logicalDate(useNow(30_000), dayStart);
  const prevToday = useRef<number | null>(null);
  // roll unfinished to-dos over only once this device has the latest data from the server (so a
  // stale copy can't undo a completion made elsewhere)
  const synced = useSyncStatus((s) => s.lastSyncAt !== null);
  useEffect(() => {
    const ui = useUI.getState();
    if (prevToday.current === null || ui.date === prevToday.current) ui.setDate(today);
    prevToday.current = today;
  }, [today]);
  useEffect(() => {
    if (!synced) return;
    useSync.getState().rollOverTodos(today);
    useSync.getState().repairBranchShared();
  }, [today, synced]);
  return null;
}

/**
 * A home-screen app has no reload button and can stay open for days. When the app comes back to the
 * foreground (or every 10 minutes), compare the server's build id with the one this page loaded with
 * and reload into the new version. Never reloads while a sheet is open (unsaved input).
 */
function ReloadOnDeploy() {
  useEffect(() => {
    let loaded: string | null = null;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { buildId } = (await r.json()) as { buildId: string };
        if (loaded === null) loaded = buildId;
        else if (buildId !== loaded) {
          const ui = useUI.getState();
          if (!ui.entry && !ui.settingsOpen) window.location.reload();
        }
      } catch {}
    };
    void check();
    const id = setInterval(check, 10 * 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return null;
}
