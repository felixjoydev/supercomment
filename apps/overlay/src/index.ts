/**
 * SuperComment injected annotation overlay — entry point.
 *
 * The proxy (U3) injects this built IIFE into every served HTML page. On load
 * we mount the shadow-DOM-isolated overlay UI: a mode-switching toolbar, the
 * four selection modes, the comment form, guest-name entry, and numbered
 * markers (R2, R5, R9, R10, R13 display).
 *
 * Seams:
 *   - U7 (context capture) — the default capturer is the REAL
 *     `RealContextCapturer` (generic + React + screenshot).
 *   - U4 (submission) — the default submitter is now the REAL
 *     `SupabaseCommentSubmitter` (guest `create_guest_comment` RPC) when the
 *     proxy-injected boot config carries a link secret + supabase url/anon key;
 *     otherwise it falls back to `StubCommentSubmitter` for standalone/dev use.
 * Both are wired through the typed `ContextCapturer` / `CommentSubmitter`
 * interfaces (see `core/types.ts`) and remain overridable via `mount(config)`.
 */
import { OverlayController } from "./controller.js";
import { StubCommentSubmitter } from "./core/stubs.js";
import { RealContextCapturer } from "./capture/index.js";
import { submitterFromBootConfig } from "./submit/index.js";
import type { OverlayConfig } from "./core/types.js";

/** Global config the proxy can set on the page before the bundle runs. */
interface InjectedBootConfig {
  previewId?: string;
  previewKey?: string;
  /** Guest link secret for `create_guest_comment` (set by `supercomment start`). */
  linkSecret?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

declare global {
  interface Window {
    __SUPERCOMMENT__?: InjectedBootConfig;
    SuperCommentOverlay?: {
      mount(config?: Partial<OverlayConfig>): OverlayController;
    };
  }
}

/**
 * Mount the overlay. The proxy/host can pass `previewId`/`previewKey`; we fall
 * back to values on `window.__SUPERCOMMENT__` or sensible dev defaults so the
 * bundle is also runnable standalone.
 */
function mount(overrides: Partial<OverlayConfig> = {}): OverlayController {
  const boot = (typeof window !== "undefined" && window.__SUPERCOMMENT__) || {};
  const previewId =
    overrides.previewId ??
    boot.previewId ??
    "00000000-0000-0000-0000-000000000000";
  const previewKey =
    overrides.previewKey ??
    boot.previewKey ??
    (typeof location !== "undefined" ? location.host : "preview");

  // Prefer the real Supabase submitter when the proxy injected a complete boot
  // config (link secret + supabase url/anon key); fall back to the stub so the
  // bundle still runs standalone (e.g. local dev / the test page).
  const submitter =
    overrides.submitter ??
    submitterFromBootConfig(boot) ??
    new StubCommentSubmitter();

  const config: OverlayConfig = {
    previewId,
    previewKey,
    capturer: overrides.capturer ?? new RealContextCapturer(),
    submitter,
    doc: overrides.doc,
    storage: overrides.storage,
  };

  return new OverlayController(config);
}

// Expose a tiny API for the proxy / tests and auto-mount in a browser.
if (typeof window !== "undefined") {
  window.SuperCommentOverlay = { mount };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => mount());
    } else {
      mount();
    }
  }
}

export { OverlayController, mount };
export type { OverlayConfig };
