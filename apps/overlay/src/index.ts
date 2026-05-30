/**
 * SuperComment injected annotation overlay — entry point (U6).
 *
 * The proxy (U3) injects this built IIFE into every served HTML page. On load
 * we mount the shadow-DOM-isolated overlay UI: a mode-switching toolbar, the
 * four selection modes, the comment form, guest-name entry, and numbered
 * markers (R2, R5, R9, R10, R13 display).
 *
 * Seams left for later units:
 *   - U7 (context capture) replaces the `StubContextCapturer`.
 *   - U5/U9 (submission) replaces the `StubCommentSubmitter`.
 * Both are wired through the typed `ContextCapturer` / `CommentSubmitter`
 * interfaces (see `core/types.ts`); U6 ships clearly-marked stubs only.
 */
import { OverlayController } from "./controller.js";
import { StubContextCapturer, StubCommentSubmitter } from "./core/stubs.js";
import type { OverlayConfig } from "./core/types.js";

/** Global config the proxy can set on the page before the bundle runs. */
interface InjectedBootConfig {
  previewId?: string;
  previewKey?: string;
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

  const config: OverlayConfig = {
    previewId,
    previewKey,
    capturer: overrides.capturer ?? new StubContextCapturer(),
    submitter: overrides.submitter ?? new StubCommentSubmitter(),
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
