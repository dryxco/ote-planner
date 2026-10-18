"use client";

import { useEffect, useState } from "react";
import { PROVIDER_LABEL, type CalendarsResponse, type CalendarProvider } from "@/lib/types";
import { useSync } from "@/lib/store";
import { useUI } from "@/lib/ui";
import { refreshCalendarEvents, useNow } from "@/lib/hooks";
import { useSyncStatus } from "@/lib/sync-client";
import { fmtMinutesOfDay } from "@/lib/time";
import { REMINDER_OPTIONS } from "./EntrySheet";
import { useThemePref } from "@/lib/theme";
import { currentSubscription, disablePush, enablePush, isStandalone, pushSupported, testPush } from "@/lib/push-client";
import { BigButton, Footnote, Group, PopupSelect, Row, SectionTitle, Sheet, Toggle } from "./ui";
import { ChevronRight } from "./icons";

const HALF_HOURS = Array.from({ length: 48 }, (_, i) => ({ value: i * 30, label: fmtMinutesOfDay(i * 30) }));

export function SettingsSheet() {
  const { settings, updateSettings } = useSync();
  const close = () => {
    useUI.getState().setSettingsOpen(false);
    useUI.getState().setCalendarError(null); // an OAuth error is about that attempt only
  };
  const [page, setPage] = useState<"main" | "calendars">("main");
  const [cal, setCal] = useState<CalendarsResponse | null>(null);
  const [calError, setCalError] = useState<string | null>(null);
  const oauthError = useUI((s) => s.calendarError);
  const [theme, setTheme] = useThemePref();

  async function loadCalendars() {
    try {
      const r = await fetch("/api/calendar/calendars", { cache: "no-store" });
      if (r.status === 404) {
        setCal({ accounts: [], calendars: [] });
        setCalError("Calendar integration isn't installed on the server yet.");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCal((await r.json()) as CalendarsResponse);
      setCalError(null);
    } catch (e) {
      setCalError(`Couldn't load calendars: ${(e as Error).message}`);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCalendars();
  }, []);

  if (page === "calendars") {
    return (
      <Sheet title="Calendars shown" onCancel={() => setPage("main")} cancelLabel="Back" onSave={close} saveLabel="Done">
        <CalendarsPage cal={cal} />
      </Sheet>
    );
  }

  const shownCount = cal ? cal.calendars.filter((c) => !settings.hiddenCalendarIds.includes(c.id)).length : 0;

  return (
    <Sheet title="Settings" onCancel={close} cancelLabel="Close" onSave={close} saveLabel="Done">
      <SectionTitle>Appearance</SectionTitle>
      <Group>
        <Row label="Theme">
          <PopupSelect
            tone="plain"
            value={theme}
            options={[
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={setTheme}
          />
        </Row>
      </Group>
      <Footnote>Saved on this device only.</Footnote>

      <SectionTitle>Time</SectionTitle>
      <Group>
        <Row label="Day start time">
          <PopupSelect tone="plain" value={settings.dayStart} options={HALF_HOURS} onChange={(v) => updateSettings({ dayStart: v })} />
        </Row>
        <Row label="Day close time">
          <PopupSelect tone="plain" value={settings.dayClose} options={HALF_HOURS} onChange={(v) => updateSettings({ dayClose: v })} />
        </Row>
        <Row label="Week starts on">
          <PopupSelect
            tone="plain"
            value={settings.weekStartsOn}
            options={[
              { value: 0, label: "Sunday" },
              { value: 1, label: "Monday" },
              { value: 6, label: "Saturday" },
            ]}
            onChange={(v) => updateSettings({ weekStartsOn: v as 0 | 1 | 6 })}
          />
        </Row>
      </Group>
      <Footnote>
        Records between the day start time and the next day start belong to one day. After the close time, the rest of the
        timeline is dimmed.
      </Footnote>

      <SectionTitle>Notification defaults</SectionTitle>
      <Group>
        <Row label="Start reminder">
          <PopupSelect
            tone="plain"
            value={settings.defaultReminder}
            options={REMINDER_OPTIONS.filter((o) => o.value !== "activity") as { value: typeof settings.defaultReminder; label: string }[]}
            onChange={(v) => updateSettings({ defaultReminder: v })}
          />
        </Row>
        <Row label="End confirmation">
          <Toggle checked={settings.defaultEndConfirmation} onChange={(v) => updateSettings({ defaultEndConfirmation: v })} />
        </Row>
      </Group>
      <Footnote>Applies to new plans. Change per activity in the Activities tab, or per plan in that plan.</Footnote>
      <PlanAlerts />
      <NotificationPermission />

      <SectionTitle>Integrations</SectionTitle>
      <Group>
        <Row label="Show calendar events">
          <Toggle
            checked={settings.showCalendarEvents}
            onChange={(v) => {
              updateSettings({ showCalendarEvents: v });
              refreshCalendarEvents();
            }}
          />
        </Row>
        <Row label="Calendars shown" onClick={() => setPage("calendars")}>
          <span className="text-fg/50 tabular">
            {shownCount}/{cal?.calendars.length ?? 0}
          </span>
          <ChevronRight size={14} className="text-fg/40" />
        </Row>
      </Group>
      <Footnote>Calendar events appear faintly in both columns. Tap one to turn it into a plan or an actual.</Footnote>

      <SectionTitle>Accounts</SectionTitle>
      <Accounts cal={cal} onChanged={loadCalendars} />
      {calError && <p className="mt-2 px-4 text-[12px] text-danger-soft">{calError}</p>}
      {oauthError && <p className="mt-2 px-4 text-[12px] text-danger-soft">Couldn’t connect Google: {oauthError}</p>}
      {cal?.errors?.map((e, i) => (
        <p key={i} className="mt-2 px-4 text-[12px] text-danger-soft">
          {PROVIDER_LABEL[e.provider]}
          {e.accountId ? ` (${e.accountId})` : ""}: {e.message}
        </p>
      ))}

      <SectionTitle>Connector</SectionTitle>
      <ConnectorSection onChanged={loadCalendars} />

      <SectionTitle>Mac menu bar</SectionTitle>
      <MenuBarSection />

      <SectionTitle>Account</SectionTitle>
      <AccountRow />

      <SectionTitle>Devices</SectionTitle>
      <SyncStatusRow />

      <SectionTitle>Data</SectionTitle>
      <DataSection />
    </Sheet>
  );
}

function CalendarsPage({ cal }: { cal: CalendarsResponse | null }) {
  const { settings, updateSettings } = useSync();
  if (!cal) return <p className="py-10 text-center text-fg/50">Loading…</p>;
  if (cal.calendars.length === 0) return <p className="py-10 text-center text-fg/50">No connected calendars.</p>;
  const hidden = new Set(settings.hiddenCalendarIds);
  // one section per calendar account (for "This Mac": per account inside Apple Calendar)
  const groups = new Map<string, { title: string; list: typeof cal.calendars }>();
  for (const c of cal.calendars) {
    const key = `${c.provider}:${c.accountId}`;
    if (!groups.has(key)) {
      const acc = cal.accounts.find((a) => a.provider === c.provider && a.accountId === c.accountId);
      const title = c.provider === "mac" ? `This Mac · ${c.accountId}` : `${PROVIDER_LABEL[c.provider]} · ${acc?.label ?? c.accountId}`;
      groups.set(key, { title, list: [] });
    }
    groups.get(key)!.list.push(c);
  }
  const hiddenEvents = settings.hiddenEventIds?.length ?? 0;
  const setMany = (ids: string[], show: boolean) => {
    const next = new Set(hidden);
    for (const id of ids) {
      if (show) next.delete(id);
      else next.add(id);
    }
    updateSettings({ hiddenCalendarIds: [...next] });
  };
  return (
    <>
      {hiddenEvents > 0 && (
        <Group className="mt-4">
          <Row label={`Hidden events: ${hiddenEvents}`}>
            <button onClick={() => updateSettings({ hiddenEventIds: [] })} className="text-[14px] text-link">
              Show again
            </button>
          </Row>
        </Group>
      )}
      {[...groups.entries()].map(([key, g]) => {
        const ids = g.list.map((c) => c.id);
        const allShown = ids.every((id) => !hidden.has(id));
        return (
          <div key={key}>
            <div className="mb-1.5 mt-5 flex items-center justify-between px-4">
              <h3 className="text-[14px] font-medium text-fg/50">{g.title}</h3>
              <button onClick={() => setMany(ids, !allShown)} className="text-[13px] text-link">
                {allShown ? "Hide all" : "Show all"}
              </button>
            </div>
            <Group>
              {g.list.map((c) => (
                <Row
                  key={c.id}
                  label={
                    <span className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                      {c.name}
                    </span>
                  }
                >
                  <Toggle checked={!hidden.has(c.id)} onChange={(v) => setMany([c.id], v)} />
                </Row>
              ))}
            </Group>
          </div>
        );
      })}
    </>
  );
}

function Accounts({ cal, onChanged }: { cal: CalendarsResponse | null; onChanged: () => void }) {
  const [appleOpen, setAppleOpen] = useState(false);
  const [icsOpen, setIcsOpen] = useState(false);
  const [icsFor, setIcsFor] = useState<"google" | "other">("other");
  const [icsUrl, setIcsUrl] = useState("");

  async function addIcs() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/calendar/ics/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: icsUrl.trim() }),
      });
      const res = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !res.ok) {
        setMsg(res.error ?? `Couldn't add (HTTP ${r.status})`);
        return;
      }
      setIcsOpen(false);
      setIcsUrl("");
      refreshCalendarEvents();
      onChanged();
    } catch (e) {
      setMsg(`Couldn't add: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function disconnect(provider: CalendarProvider, accountId: string) {
    setBusy(true);
    try {
      const endpoint = {
        google: "/api/auth/google/disconnect",
        apple: "/api/calendar/apple/disconnect",
        ics: "/api/calendar/ics/remove",
        connector: "/api/connector/disconnect",
        mac: "/api/calendar/mac",
      }[provider];
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(provider === "mac" ? { enabled: false } : { accountId }),
      });
      if (!r.ok) setMsg(`Couldn't disconnect (HTTP ${r.status})`);
    } finally {
      setBusy(false);
      refreshCalendarEvents();
      onChanged();
    }
  }

  async function connectApple() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/calendar/apple/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appleId: appleId.trim(), appPassword: appPassword.trim() }),
      });
      const res = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !res.ok) {
        setMsg(res.error ?? `Couldn't connect (HTTP ${r.status})`);
        return;
      }
      setAppleOpen(false);
      setAppPassword("");
      refreshCalendarEvents();
      onChanged();
    } catch (e) {
      setMsg(`Couldn't connect: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Group>
        {cal?.accounts.map((a) => (
          <Row
            key={`${a.provider}:${a.accountId}`}
            label={
              <span className="flex flex-col">
                <span>{{ google: "Google Calendar", apple: "Apple iCloud Calendar", ics: "iCal link", connector: "Connector", mac: "This Mac" }[a.provider]}</span>
                <span className="text-[12px] text-fg/45">{a.label}</span>
              </span>
            }
          >
            <button disabled={busy} onClick={() => disconnect(a.provider, a.accountId)} className="text-[14px] text-[#ff453a]">
              Disconnect
            </button>
          </Row>
        ))}
        <Row
          label={
            <span className="flex flex-col">
              <span>This Mac’s calendars (Apple Calendar)</span>
              <span className="text-[12px] text-fg/45">Every calendar in Apple Calendar · includes shared Google calendars</span>
            </span>
          }
        >
          <Toggle
            checked={!!cal?.accounts.some((a) => a.provider === "mac")}
            disabled={busy}
            onChange={async (v) => {
              setBusy(true);
              setMsg(null);
              try {
                const r = await fetch("/api/calendar/mac", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ enabled: v }),
                });
                const res = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
                if (!r.ok || !res.ok) setMsg(res.error ?? `Failed (HTTP ${r.status})`);
              } finally {
                setBusy(false);
                refreshCalendarEvents();
                onChanged();
              }
            }}
          />
        </Row>
        {cal?.googleOAuth ? (
          // Full-page navigation: the OAuth flow leaves the app and returns to /?settings=1
          <a
            href="/api/auth/google/start"
            className="flex min-h-[46px] w-full items-center justify-between border-b border-fg/[0.08] px-4 text-[15px] text-link"
          >
            Connect Google Calendar
            <ChevronRight size={14} className="text-fg/40" />
          </a>
        ) : (
          // No OAuth client on this server: Google calendars connect through their secret iCal link
          <Row
            label={<span className="text-link">Connect Google Calendar</span>}
            onClick={() => {
              setIcsFor("google");
              setIcsOpen((v) => !(v && icsFor === "google"));
            }}
          >
            <ChevronRight size={14} className={icsOpen && icsFor === "google" ? "rotate-90 text-fg/40" : "text-fg/40"} />
          </Row>
        )}
        <Row label={<span className="text-link">Connect Apple (iCloud) Calendar</span>} onClick={() => setAppleOpen((v) => !v)}>
          <ChevronRight size={14} className={appleOpen ? "rotate-90 text-fg/40" : "text-fg/40"} />
        </Row>
        <Row
          label={<span className="text-link">Add calendar by iCal link</span>}
          onClick={() => {
            setIcsFor("other");
            setIcsOpen((v) => !(v && icsFor === "other"));
          }}
        >
          <ChevronRight size={14} className={icsOpen && icsFor === "other" ? "rotate-90 text-fg/40" : "text-fg/40"} />
        </Row>
      </Group>
      {icsOpen && (
        <div className="mt-3">
          <Group>
            <input
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              autoComplete="off"
              className="h-[46px] w-full bg-transparent px-4 text-[15px] outline-none placeholder:text-fg/30"
            />
          </Group>
          {icsFor === "google" ? (
            <Footnote>
              <b>Google Calendar</b> — on a computer open calendar.google.com → ⚙ Settings → under &quot;Settings for my calendars&quot;
              pick the calendar → <b>Integrate calendar</b> → copy <b>&quot;Secret address in iCal format&quot;</b> and paste it above.
              Repeat for each calendar. Read-only, refreshed every few minutes; the link is stored encrypted on the Sync server only.
            </Footnote>
          ) : (
            <Footnote>
              Any calendar with an iCal (.ics / webcal://) link. Read-only, refreshed every few minutes; the link is stored encrypted on
              the Sync server only.
            </Footnote>
          )}
          <BigButton onClick={addIcs} disabled={busy || !icsUrl.trim()}>
            {busy ? "Adding…" : "Add calendar"}
          </BigButton>
        </div>
      )}
      {appleOpen && (
        <div className="mt-3">
          <Group>
            <input
              value={appleId}
              onChange={(e) => setAppleId(e.target.value)}
              placeholder="Apple ID (email)"
              autoComplete="username"
              className="h-[46px] w-full border-b border-fg/[0.08] bg-transparent px-4 text-[15px] outline-none placeholder:text-fg/30"
            />
            <input
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="App-specific password (xxxx-xxxx-xxxx-xxxx)"
              type="password"
              autoComplete="current-password"
              className="h-[46px] w-full bg-transparent px-4 text-[15px] outline-none placeholder:text-fg/30"
            />
          </Group>
          <Footnote>
            Create an app-specific password at appleid.apple.com → Sign-In and Security → App-Specific Passwords. Your normal Apple
            ID password will not work.
          </Footnote>
          <BigButton onClick={connectApple} disabled={busy || !appleId || !appPassword}>
            {busy ? "Connecting…" : "Connect"}
          </BigButton>
        </div>
      )}
      {msg && <p className="mt-2 px-4 text-[12px] text-danger-soft">{msg}</p>}
    </>
  );
}

function DataSection() {
  const [msg, setMsg] = useState<string | null>(null);
  function exportData() {
    const s = useSync.getState();
    const data = { activities: s.activities, plans: s.plans, actuals: s.actuals, todos: s.todos, goals: s.goals, settings: s.settings };
    const blob = new Blob([JSON.stringify({ app: "sync", version: 1, data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sync-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importData(file: File) {
    file.text().then((txt) => {
      try {
        const parsed = JSON.parse(txt) as { app?: string; data?: Record<string, unknown> };
        if (parsed.app !== "sync" || !parsed.data) throw new Error("Not a Sync backup file.");
        useSync.setState(parsed.data as Partial<ReturnType<typeof useSync.getState>>);
        setMsg("Import complete");
      } catch (e) {
        setMsg(`Import failed: ${(e as Error).message}`);
      }
    });
  }
  return (
    <>
      <Group>
        <Row label={<span className="text-link">Export backup (JSON)</span>} onClick={exportData} />
        <label className="flex min-h-[46px] w-full cursor-pointer items-center px-4 text-[15px] text-link">
          Import backup…
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
        </label>
      </Group>
      <Footnote>Backups include everything synced to this device.</Footnote>
      {msg && <p className="px-4 text-[12px] text-fg/60">{msg}</p>}
    </>
  );
}

/** Plan alerts pushed by the server: 10 min before a plan and when it ends, app open or not. */
function PlanAlerts() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const supported = pushSupported();
  const standalone = supported && isStandalone();
  useEffect(() => {
    let live = true;
    void currentSubscription().then((s) => live && setOn(!!s));
    return () => {
      live = false;
    };
  }, []);
  const run = (f: () => Promise<void>, ok: string, next?: boolean) => {
    setBusy(true);
    setMsg(null);
    f()
      .then(() => {
        if (next !== undefined) setOn(next);
        setMsg(ok);
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <Group>
        <Row label="Plan alerts on this device">
          {supported ? (
            <Toggle
              checked={!!on}
              disabled={busy || on === null}
              onChange={(v) => run(v ? enablePush : disablePush, v ? "Alerts are on." : "Alerts are off.", v)}
            />
          ) : (
            <span className="text-[13px] text-fg/50">Not supported here</span>
          )}
        </Row>
        {on && (
          <Row label="Send a test alert">
            <button disabled={busy} onClick={() => run(testPush, "Test alert sent.")} className="text-[15px] text-link disabled:opacity-40">
              Send
            </button>
          </Row>
        )}
      </Group>
      <Footnote>
        {msg ? `${msg} ` : ""}
        10 minutes before each plan and when it ends, even when Sync is closed. Turn this on only on your iPhone
        {supported && !standalone ? " (open Sync from its Home Screen icon first)" : ""} — Apple Watch, and a Mac with iPhone
        Mirroring, show the same alert, so nothing arrives twice.
      </Footnote>
    </>
  );
}

function NotificationPermission() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  if (perm === "unsupported") return null;
  return (
    <>
      <Group>
        <Row label="System notifications">
          {perm === "granted" ? (
            <span className="text-[14px] text-fg/50">On</span>
          ) : perm === "denied" ? (
            <span className="text-[14px] text-fg/50">Blocked in browser</span>
          ) : (
            <button onClick={() => Notification.requestPermission().then(setPerm)} className="text-[15px] text-link">
              Allow
            </button>
          )}
        </Row>
      </Group>
      <Footnote>Reminders and end confirmations fire while Sync is open in a tab. Without permission they show as banners.</Footnote>
    </>
  );
}

function SyncStatusRow() {
  const { lastSyncAt, error, syncing } = useSyncStatus();
  const now = useNow(5000);
  const ago = lastSyncAt ? Math.max(0, Math.round((now - lastSyncAt) / 1000)) : null;
  return (
    <>
      <Group>
        <Row label="Sync across devices">
          <span className={error ? "text-[13px] text-danger-soft" : "text-[13px] text-fg/50"}>
            {error ? "Error" : syncing && ago === null ? "Syncing…" : ago === null ? "Not yet" : ago < 10 ? "Up to date" : `${ago}s ago`}
          </span>
        </Row>
      </Group>
      <Footnote>
        {error ??
          "Plans, actuals, to-dos, goals and settings are saved on the Sync server and appear on every device that opens this app. Edits made offline sync when the connection is back."}
      </Footnote>
    </>
  );
}

function MenuBarSection() {
  const [msg, setMsg] = useState<string | null>(null);
  async function copyToken() {
    try {
      const r = await fetch("/api/menubar/token", { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!j.token) throw new Error(j.error ?? `HTTP ${r.status}`);
      await navigator.clipboard.writeText(j.token);
      setMsg("Copied ✓");
    } catch (e) {
      setMsg(`Couldn’t copy the token: ${(e as Error).message}`);
    }
  }
  return (
    <>
      <Group>
        <a
          href="/api/menubar/download"
          download
          className="flex min-h-[46px] w-full items-center justify-between gap-3 border-b border-fg/[0.08] px-4 text-[15px] text-link"
        >
          Download for Mac
          <span className="text-[12px] text-fg/45">SyncMenuBar.zip</span>
        </a>
        <Row label={<span className="text-link">Copy menu bar token</span>} onClick={() => void copyToken()}>
          {msg === "Copied ✓" && <span className="text-[13px] text-fg/50">{msg}</span>}
        </Row>
      </Group>
      <Footnote>
        The Sync menu bar app shows the plan in progress and the time left. Download, unzip, move it to Applications and open
        it (the first time: right-click → Open). Then choose “Set up…” and paste the token — it only lets the app read your
        current and next plan. That Mac needs to reach this server.
      </Footnote>
      {msg && msg !== "Copied ✓" && <p className="px-4 text-[12px] text-danger-soft">{msg}</p>}
    </>
  );
}

function AccountRow() {
  const [me, setMe] = useState<{ userId: string | null; method: string; email: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);
  if (me?.method === "off") return <Footnote>Sign-in is off on this server (SYNC_AUTH=off): anyone who can reach it can open Sync.</Footnote>;
  return (
    <>
      <Group>
        <Row label="Signed in">
          <span className="truncate text-[13px] text-fg/50">{me ? (me.method === "password" ? "with the password" : (me.email ?? me.userId)) : "—"}</span>
        </Row>
        <Row
          label={<span className="text-[#ff453a]">Sign out</span>}
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
            window.location.replace("/login");
          }}
        />
      </Group>
    </>
  );
}

interface ConnectorField {
  key: string;
  label: string;
  secret: boolean;
  placeholder: string;
  default: string;
}
type SyncRun = { lastOkAt: number | null; lastError: string | null; linked: number; lastResult: Record<string, number> | null };
interface ConnectorStatus {
  connected: boolean;
  available: { id: string; label: string; description: string | null; fields: ConnectorField[] }[];
  label?: string;
  account?: { id: string; label: string };
  tasks?: SyncRun;
  tickets?: SyncRun;
}

/** The outside service (connectors/) tasks, tickets and events are mirrored with. */
function ConnectorSection({ onChanged }: { onChanged: () => void }) {
  const [st, setSt] = useState<ConnectorStatus | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/connector/status", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setSt((await r.json()) as ConnectorStatus);
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state set after await
    void load();
  }, []);

  async function post(url: string, body: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const res = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || res.ok === false) setMsg(res.error ?? `Failed (HTTP ${r.status})`);
      return r.ok && res.ok !== false;
    } finally {
      setBusy(false);
      await load();
      refreshCalendarEvents();
      onChanged();
    }
  }

  if (!st) return <p className="px-4 text-[13px] text-fg/40">Loading…</p>;

  if (!st.connected) {
    const def = st.available.find((d) => d.id === (pick ?? st.available[0]?.id));
    if (!def) return <Footnote>No connectors are registered (src/lib/server/connectors/index.ts).</Footnote>;
    const val = (f: ConnectorField) => values[f.key] ?? f.default;
    return (
      <>
        {st.available.length > 1 && (
          <Group>
            {st.available.map((d) => (
              <Row key={d.id} label={d.label} onClick={() => setPick(d.id)}>
                {d.id === def.id && <span className="text-link">✓</span>}
              </Row>
            ))}
          </Group>
        )}
        <Group>
          {def.fields.map((f) => (
            <input
              key={f.key}
              value={val(f)}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder || f.label}
              aria-label={f.label}
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              className="h-[46px] w-full bg-transparent px-4 text-[14px] outline-none placeholder:text-fg/30"
            />
          ))}
        </Group>
        <Footnote>
          {def.description ?? def.label} Keeps your to-dos and timed plans in step with its task board, your assigned tickets on the Tickets board,
          and shows its calendars — whatever the service supports. Sync works the same without it.
        </Footnote>
        <BigButton
          onClick={() =>
            void post("/api/connector/connect", { connector: def.id, config: Object.fromEntries(def.fields.map((f) => [f.key, val(f)])) }).then(
              (ok) => ok && setValues({}),
            )
          }
          disabled={busy || def.fields.some((f) => !val(f).trim())}
        >
          {busy ? "Connecting…" : `Connect ${def.label}`}
        </BigButton>
        {msg && <p className="mt-2 px-4 text-[12px] text-danger-soft">{msg}</p>}
      </>
    );
  }

  const status = (t?: SyncRun) => (
    <span className={t?.lastError ? "text-[13px] text-danger-soft" : "text-[13px] text-fg/50"}>
      {t?.lastError ? "Error" : t?.lastOkAt ? `${t.linked} linked · ${new Date(t.lastOkAt).toLocaleTimeString()}` : "Starting…"}
    </span>
  );
  const t = st.tasks;
  const r = t?.lastResult;
  return (
    <>
      <Group>
        <Row label={st.label ?? "Connector"}>
          <span className="truncate text-[13px] text-fg/50">{st.account?.label}</span>
        </Row>
        <Row label="Tasks sync">{status(st.tasks)}</Row>
        <Row label="Tickets sync">{status(st.tickets)}</Row>
        <Row label={<span className="text-link">Sync now</span>} onClick={() => void post("/api/connector/sync-now", {})} />
        <Row label={<span className="text-[#ff453a]">Disconnect</span>} onClick={() => void post("/api/connector/disconnect", {})} />
      </Group>
      <Footnote>
        {t?.lastError || st.tickets?.lastError
          ? (t?.lastError ?? st.tickets?.lastError)
          : r
            ? `Last run: ${r.pulledNew + r.pulledUpdates} in, ${r.pushedNew + r.pushedUpdates} out, ${r.archived} removed there, ${r.deletedLocal} removed here. Runs every minute and right after you edit something.`
            : "Runs every minute and right after you edit something."}
      </Footnote>
      {msg && <p className="mt-2 px-4 text-[12px] text-danger-soft">{msg}</p>}
    </>
  );
}
