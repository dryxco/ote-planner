"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { UndoKeys } from "./UndoKeys";
import { BookIcon, CalendarIcon, ChartIcon, FlagIcon, FolderIcon, GridIcon, HomeIcon, SunIcon } from "./icons";
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
  { href: "/today", label: "Today", Icon: SunIcon },
  { href: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { href: "/projects", label: "Projects", Icon: FolderIcon },
  { href: "/diary", label: "Diary", Icon: BookIcon },
  { href: "/review", label: "Review", Icon: ChartIcon },
  { href: "/activities", label: "Activities", Icon: GridIcon },
  { href: "/goals", label: "Goals", Icon: FlagIcon },
];

const TABS = [
  { href: "/", label: "Today", Icon: SunIcon },
  { href: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { href: "/projects", label: "Projects", Icon: FolderIcon },
  { href: "/review", label: "Review", Icon: ChartIcon },
  { href: "/activities", label: "Activities", Icon: GridIcon },
  { href: "/goals", label: "Goals", Icon: FlagIcon },
];

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
    // computers: side rail instead of the floating tab bar; Today becomes the three-pane home,
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
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-fg/[0.07] py-4">
      {/* the app icon, on the ground that matches the theme */}
      <span className="mb-3 block h-[40px] w-[40px]" title="Ote">
        {/* eslint-disable-next-line @next/next/no-img-element -- a 40px static icon */}
        <img src="/icons/icon-192.png" alt="Ote" width={40} height={40} className="h-full w-full rounded-[11px] [[data-theme=light]_&]:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element -- a 40px static icon */}
        <img src="/icons/icon-light-192.png" alt="Ote" width={40} height={40} className="hidden h-full w-full rounded-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)] [[data-theme=light]_&]:block" />
      </span>
      {DESKTOP_TABS.map(({ href, label, Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cx(
              "flex w-[60px] flex-col items-center gap-1 rounded-[12px] py-2 text-[10px] font-medium",
              active ? "bg-fg/10 text-[#0a84ff]" : "text-fg/80 hover:bg-fg/5",
            )}
          >
            <Icon size={20} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-4 pb-[max(10px,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto mx-auto flex h-[62px] items-stretch rounded-full border border-fg/10 bg-surface/90 p-1 shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-xl">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" || pathname === "/today" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                "flex flex-1 flex-col items-center justify-center gap-[3px] rounded-full text-[10px] font-medium transition-colors",
                active ? "bg-fg/10 text-[#0a84ff]" : "text-fg",
              )}
            >
              <Icon size={22} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
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
