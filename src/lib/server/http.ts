// Shared helpers for calendar/auth route handlers.

/** Error whose message is safe and meaningful to show the user (says WHY). */
export class ProviderError extends Error {
  constructor(
    message: string,
    /** Credentials are no longer usable; the user must reconnect. */
    readonly needsReconnect = false,
  ) {
    super(message);
  }
}

export function appUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

export function isSecureApp(): boolean {
  return appUrl().startsWith("https://");
}

export function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Human-readable reason for a fetch failure (network layer, not HTTP status). */
export function networkReason(err: unknown): string | null {
  const e = err as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  const code = e?.cause?.code ?? e?.code;
  if (e?.name === "TimeoutError" || e?.cause?.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
    return "timed out";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS lookup failed (check your internet connection)";
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return "couldn't connect to server (check your network)";
  }
  if (e?.name === "TypeError" && /fetch failed/i.test(String((err as Error).message))) return "network error";
  return null;
}

export function errorMessage(err: unknown, fallbackPrefix: string): string {
  if (err instanceof ProviderError) return err.message;
  const net = networkReason(err);
  if (net) return `${fallbackPrefix}: ${net}`;
  return `${fallbackPrefix}: ${err instanceof Error ? err.message : String(err)}`;
}

/**
 * Basic CSRF guard for state-changing JSON endpoints: require a JSON content type
 * (cross-site forms can't send it without a CORS preflight) and a same-origin Origin
 * header when the browser sends one.
 */
export function checkSameOrigin(request: Request): Response | null {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "Content-Type: application/json required" }, 415);
  }
  return checkOriginOnly(request);
}

/**
 * The same guard for a file upload (multipart can't be JSON): a custom header that a cross-site form
 * can't send without a CORS preflight, plus the same-origin check.
 */
export function checkSameOriginUpload(request: Request): Response | null {
  if (request.headers.get("x-sync-upload") !== "1") return json({ ok: false, error: "x-sync-upload header required" }, 415);
  return checkOriginOnly(request);
}

function checkOriginOnly(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {}
    const allowed = new Set([host, safeHost(appUrl())].filter(Boolean));
    if (!originHost || !allowed.has(originHost)) {
      return json({ ok: false, error: "Cross-origin requests aren't allowed" }, 403);
    }
  }
  return null;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Fetch with a per-request timeout. */
export function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, ms = 20_000): Promise<Response> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  return fetch(input, { ...init, signal });
}
