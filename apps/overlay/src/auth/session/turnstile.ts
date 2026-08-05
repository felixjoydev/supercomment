/**
 * Embedded review-session — Turnstile (U4) invisible token acquisition.
 *
 * When a site key is configured (boot config `turnstileSiteKey`), load the
 * Turnstile script + render an INVISIBLE widget and resolve a token to send to
 * the exchange. When NO site key is configured (dev), resolve null immediately
 * (the server skips verification when TURNSTILE_SECRET_KEY is unset). Every DOM
 * seam is injectable so the pure decision logic is unit-tested; the real
 * script-load + widget render path is VERIFY IN REAL ENV. supabase-js-free. Part
 * of the auth/session barrel (see ../session.ts).
 */

/** The subset of the Turnstile render API we use. */
interface TurnstileRenderParams {
  sitekey: string;
  /**
   * How visible the widget is. NOT the same thing as `size`, which only accepts
   * "normal" | "flexible" | "compact" — passing anything else (we used to pass
   * "invisible") makes Turnstile throw a TurnstileError and never solve.
   */
  appearance?: "always" | "execute" | "interaction-only";
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "timeout-callback"?: () => void;
}

interface TurnstileApi {
  render(container: unknown, params: TurnstileRenderParams): string | undefined;
  /** Tear a widget down by id, so removing its container doesn't orphan it. */
  remove?(widgetId: string): void;
}

/** Minimal window surface (injectable) so timers + the global are testable. */
interface TurnstileWindowLike {
  turnstile?: TurnstileApi;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** Minimal document surface (injectable) for the hidden widget container. */
interface TurnstileElementLike {
  style: Record<string, string>;
  remove?(): void;
}
interface TurnstileDocumentLike {
  createElement(tag: string): TurnstileElementLike;
  body: { appendChild(node: unknown): void };
}

export interface GetTurnstileTokenOptions {
  /** Cloudflare Turnstile site key from boot config; null/empty → dev (no token). */
  siteKey?: string | null;
  /** Injectable document seam (defaults to the ambient document). */
  doc?: TurnstileDocumentLike | null;
  /** Injectable window seam (defaults to the ambient window). */
  win?: TurnstileWindowLike | null;
  /** Injectable script loader (defaults to loading the Cloudflare api.js once). */
  loadScript?: () => Promise<void>;
  /** Max time to wait for a token before resolving null. */
  timeoutMs?: number;
}

/**
 * Acquire an invisible Turnstile token, or null when not configured / on any
 * failure. NEVER throws — a failure here must not break activation (the server
 * decides whether a token is required).
 */
export async function getTurnstileToken(
  opts: GetTurnstileTokenOptions,
): Promise<string | null> {
  const siteKey = opts.siteKey;
  if (!siteKey) return null; // dev / not configured → no token, no DOM work.

  const doc = opts.doc ?? defaultTurnstileDocument();
  const win = opts.win ?? defaultTurnstileWindow();
  if (!doc || !win) return null;

  const load = opts.loadScript ?? loadTurnstileScript;
  try {
    await load();
  } catch {
    return null;
  }

  const turnstile = win.turnstile;
  if (!turnstile || typeof turnstile.render !== "function") return null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let container: TurnstileElementLike | null = null;
    let widgetId: string | undefined;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      win.clearTimeout(timer);
      try {
        // Tear the WIDGET down before its container, otherwise Turnstile keeps
        // an internal reference and warns "Cannot find Widget ..." on cleanup.
        if (widgetId && typeof turnstile.remove === "function") {
          turnstile.remove(widgetId);
        }
      } catch {
        // ignore widget cleanup failures
      }
      try {
        container?.remove?.();
      } catch {
        // ignore container cleanup failures
      }
      resolve(value);
    };
    const timer = win.setTimeout(() => finish(null), opts.timeoutMs ?? 12_000);
    try {
      container = doc.createElement("div");
      container.style.display = "none";
      doc.body.appendChild(container);
      // REAL-ENV FIX: we used to pass `size: "invisible"` plus a follow-up
      // execute(). Turnstile rejects that `size` value outright ("expected
      // compact, flexible, or normal"), so every activation threw a
      // TurnstileError, the widget never solved, and the only exit was the
      // timeout below — i.e. NO token was ever produced and the exchange always
      // ran unverified. The execute() call then targeted a widget that was
      // never rendered in execute mode, logging "already executing" / "cannot
      // find widget". `appearance: "interaction-only"` is the supported way to
      // keep the widget out of sight unless Cloudflare genuinely needs input.
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: (token) => finish(token || null),
        "error-callback": () => finish(null),
        "timeout-callback": () => finish(null),
      });
    } catch {
      finish(null);
    }
  });
}

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let turnstileScriptPromise: Promise<void> | null = null;

/**
 * Load the Turnstile script once (idempotent). Uses the ambient document — this
 * is the real-env path; tests inject `loadScript` to bypass it. VERIFY IN REAL ENV.
 */
function loadTurnstileScript(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("no_document"));
  }
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      'script[src^="https://challenges.cloudflare.com/turnstile"]',
    );
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile_script_failed"));
    (document.head ?? document.body ?? document.documentElement).appendChild(
      script,
    );
  });
  return turnstileScriptPromise;
}

function defaultTurnstileWindow(): TurnstileWindowLike | null {
  try {
    if (typeof window !== "undefined") {
      return window as unknown as TurnstileWindowLike;
    }
  } catch {
    // ignore
  }
  return null;
}

function defaultTurnstileDocument(): TurnstileDocumentLike | null {
  try {
    if (typeof document !== "undefined") {
      return document as unknown as TurnstileDocumentLike;
    }
  } catch {
    // ignore
  }
  return null;
}
