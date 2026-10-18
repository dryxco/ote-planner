"use client";

import { useEffect, useRef, useState } from "react";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; userCode: string; verificationUri: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

function nextPath(): string {
  const n = new URLSearchParams(window.location.search).get("next") ?? "/";
  // same-site paths only
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/";
}

export function LoginView() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [methods, setMethods] = useState<{ password: boolean; device: { label: string } | null } | null>(null);
  const [password, setPassword] = useState("");
  useEffect(() => {
    fetch("/api/auth/methods", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMethods)
      .catch(() => setMethods({ password: true, device: null }));
  }, []);
  const deviceLabel = methods?.device?.label ?? "your server";

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setPhase({ kind: "starting" });
    try {
      const r = await fetch("/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const body = (await r.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!r.ok || body.status !== "ok") throw new Error(body.error ?? `HTTP ${r.status}`);
      setPhase({ kind: "done" });
      window.location.replace(nextPath());
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    }
  }
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  async function copy(text: string, what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt("Copy this", text);
    }
  }

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  async function start() {
    setPhase({ kind: "starting" });
    try {
      const r = await fetch("/api/auth/device/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await r.json().catch(() => ({}))) as { userCode?: string; verificationUri?: string; expiresIn?: number; interval?: number; error?: string };
      if (!r.ok || !body.userCode || !body.verificationUri) throw new Error(body.error ?? `HTTP ${r.status}`);
      setPhase({ kind: "waiting", userCode: body.userCode, verificationUri: body.verificationUri });
      poll(Math.max(1, body.interval ?? 3) * 1000);
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  }

  function poll(every: number) {
    pollTimer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/auth/device/poll", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        const body = (await r.json().catch(() => ({}))) as { status?: string; error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        if (body.status === "ok") {
          setPhase({ kind: "done" });
          window.location.replace(nextPath());
          return;
        }
        if (body.status === "expired") {
          setPhase({ kind: "error", message: "The code expired. Try again." });
          return;
        }
        poll(every);
      } catch (e) {
        setPhase({ kind: "error", message: (e as Error).message });
      }
    }, every);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-[28px] font-semibold">Sync</h1>
        <p className="mt-1 text-[14px] text-fg/55">Plan · Actual</p>
      </div>

      {phase.kind === "waiting" ? (
        <div className="flex w-full flex-col items-center gap-4 rounded-[18px] bg-surface p-5">
          <p className="text-[14px] text-fg/70">Approve this code on {deviceLabel}</p>
          <button
            data-user-code
            onClick={() => copy(phase.userCode, "code")}
            className="font-mono text-[30px] font-semibold tracking-[0.12em]"
            title="Tap to copy"
          >
            {phase.userCode}
          </button>
          <a
            href={phase.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[#0a84ff] text-[15px] font-semibold"
          >
            Approve on {deviceLabel}
          </a>
          <div className="flex w-full gap-2">
            <button
              onClick={() => copy(phase.verificationUri, "link")}
              className="h-[40px] flex-1 rounded-[12px] bg-fg/10 text-[13px]"
            >
              {copied === "link" ? "Copied ✓" : "Copy approval link"}
            </button>
            <button onClick={() => copy(phase.userCode, "code")} className="h-[40px] flex-1 rounded-[12px] bg-fg/10 text-[13px]">
              {copied === "code" ? "Copied ✓" : "Copy code"}
            </button>
          </div>
          <p className="w-full text-left text-[12px] leading-snug text-fg/50">
            Not signed in there on this device? <b className="text-fg/75">Copy the approval link</b> and open it where you are. This screen moves on
            automatically once approved.
          </p>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-3">
          {methods?.password && (
            <form onSubmit={signInWithPassword} className="flex w-full flex-col gap-3">
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                aria-label="Password"
                className="h-[50px] w-full rounded-[14px] bg-surface px-4 text-[16px] outline-none"
              />
              <button
                type="submit"
                disabled={!password || phase.kind === "starting" || phase.kind === "done"}
                className="flex h-[50px] w-full items-center justify-center rounded-[14px] bg-fg text-[16px] font-semibold text-bg disabled:opacity-50"
              >
                {phase.kind === "starting" ? "Signing in…" : phase.kind === "done" ? "Signed in" : "Sign in"}
              </button>
            </form>
          )}
          {methods?.device && (
            <button
              onClick={start}
              disabled={phase.kind === "starting" || phase.kind === "done"}
              className={`flex h-[50px] w-full items-center justify-center rounded-[14px] text-[16px] font-semibold disabled:opacity-50 ${methods.password ? "bg-fg/10" : "bg-fg text-bg"}`}
            >
              Sign in with {deviceLabel}
            </button>
          )}
          {methods && !methods.password && !methods.device && (
            <p className="rounded-[12px] bg-fg/[0.06] px-4 py-3 text-left text-[13px] text-fg/70">
              No sign-in is set up on this server. Set <span className="font-mono">SYNC_PASSWORD</span> in <span className="font-mono">.env.local</span> and restart it.
            </p>
          )}
        </div>
      )}

      {phase.kind === "error" && (
        <div className="w-full">
          <p className="rounded-[12px] bg-[#ff453a]/15 px-4 py-3 text-[13px] text-danger-soft">{phase.message}</p>
          {methods?.device && !methods.password && (
            <button onClick={start} className="mt-3 text-[14px] text-link">
              Try again
            </button>
          )}
        </div>
      )}
    </main>
  );
}
