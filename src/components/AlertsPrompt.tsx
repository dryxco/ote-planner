"use client";

import { useEffect, useState } from "react";
import { currentSubscription, enablePush, isStandalone, pushSupported } from "@/lib/push-client";
import { useFinePointer } from "@/lib/media";

const DISMISS_KEY = "sync-alerts-prompt-dismissed";

/**
 * On a phone running the Home Screen app with plan alerts off: a one-tap card to turn them on
 * (iOS only asks for notification permission from a tap).
 */
export function AlertsPrompt() {
  const fine = useFinePointer();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (fine || !pushSupported() || !isStandalone() || Notification.permission === "denied") return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {}
    let live = true;
    void currentSubscription().then((s) => live && !s && setShow(true));
    return () => {
      live = false;
    };
  }, [fine]);

  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setShow(false);
  };
  return (
    <div data-alerts-prompt className="mx-4 mb-2 flex items-center gap-3 rounded-[14px] bg-surface px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold">Plan alerts</p>
        <p className="text-[12px] leading-snug text-fg/55">{err ?? "10 min before each plan and when it ends — even with Sync closed."}</p>
      </div>
      <button onClick={dismiss} className="shrink-0 px-1 text-[12.5px] text-fg/45">
        Later
      </button>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setErr(null);
          enablePush()
            .then(() => setShow(false))
            .catch((e: Error) => setErr(e.message))
            .finally(() => setBusy(false));
        }}
        className="h-[32px] shrink-0 rounded-[10px] bg-fg/80 px-3 text-[13px] font-semibold text-bg disabled:opacity-40"
      >
        Turn on
      </button>
    </div>
  );
}
