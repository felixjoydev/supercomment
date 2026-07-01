/**
 * SuperComment overlay — entry point.
 *
 * The overlay is delivered two ways:
 *
 *   TUNNEL MODE (legacy, dormant): `supercomment start` proxies the dev's app
 *   and injects this IIFE plus a boot config carrying a `linkSecret` + supabase
 *   url/anon key. When a `linkSecret` is present we keep the original behaviour:
 *   auto-mount on load and write via `SupabaseCommentSubmitter` (guest
 *   `create_guest_comment`).
 *
 *   EMBEDDED MODE (U3, primary): the overlay is loaded on the customer's own
 *   deployed origin and is DORMANT BY DEFAULT — it mounts nothing and binds no
 *   listeners unless a review session is active (R2, R18). Activation is gated on
 *   a short-lived token delivered in the URL fragment by the `/s` hop:
 *
 *     1. SYNCHRONOUSLY read `#sc_token=<token>` and `history.replaceState` to
 *        strip it — before ANY async work (so it never lingers for error
 *        reporters / Referer).
 *     2. No token AND no unexpired persisted session → stay dormant (return).
 *     3. Else: anon sign-in → exchange the token for a preview-scoped session →
 *        persist it (sessionStorage) → mount with the `SessionCommentSubmitter`
 *        (writes authorize via the anon session JWT, NOT anon-key + link secret).
 *     4. On reload (no token) the persisted session is restored and re-mounted —
 *        reload is what triggers redeploy-reconcile, so persistence is mandatory.
 *
 * Seams (overridable via `mount(config)`): `ContextCapturer` (U7) and
 * `CommentSubmitter` (see `core/types.ts`).
 */
import { OverlayController } from "./controller.js";
import { StubCommentSubmitter } from "./core/stubs.js";
import { RealContextCapturer } from "./capture/index.js";
import { submitterFromBootConfig } from "./submit/index.js";
import { SessionCommentSubmitter } from "./submit/session.js";
import { CaptureUploader } from "./submit/upload.js";
import { loadReviewComments, toExistingMarkers } from "./read/load-comments.js";
import { isDeviceChild } from "./device/device-mode.js";
import {
  REFRESH_SKEW_MS,
  anonSignIn,
  clearSession,
  exchangeReviewToken,
  getTurnstileToken,
  isExpired,
  persistSession,
  readTokenFromHash,
  refreshAccessToken,
  restoreSession,
  stripTokenFromHash,
  type PersistedSession,
} from "./auth/session.js";
import type { NameStorage, OverlayConfig } from "./core/types.js";

/** Global config set on the page before the bundle runs. */
interface InjectedBootConfig {
  previewId?: string;
  previewKey?: string;
  /** TUNNEL MODE: guest link secret (selects the legacy auto-mount path). */
  linkSecret?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** EMBEDDED MODE: SuperComment backend origin for the token exchange. */
  backendOrigin?: string;
  /**
   * EMBEDDED MODE (U4): Cloudflare Turnstile site key. When set, the overlay
   * acquires an invisible Turnstile token and includes it in the exchange. When
   * absent (dev), no token is sent and the server skips verification.
   */
  turnstileSiteKey?: string;
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
 * Mount the overlay. Used by the tunnel auto-mount, the embedded activation
 * path, and standalone/test callers (`window.SuperCommentOverlay.mount()`). The
 * submitter precedence is: explicit override → tunnel boot config
 * (`SupabaseCommentSubmitter`) → console stub.
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

  const submitter =
    overrides.submitter ??
    submitterFromBootConfig(boot) ??
    new StubCommentSubmitter();

  const config: OverlayConfig = {
    previewId,
    previewKey,
    capturer: overrides.capturer ?? new RealContextCapturer(),
    submitter,
    // U13: out-of-band screenshot upload (embedded activation wires the real one).
    uploader: overrides.uploader,
    doc: overrides.doc,
    storage: overrides.storage,
  };

  return new OverlayController(config);
}

// ---------------------------------------------------------------------------
// Dormant / token-gated bootstrap (embedded mode) + tunnel auto-mount.
// ---------------------------------------------------------------------------

/** Resolve after the DOM is ready so the shell mounts against a parsed document. */
function whenDomReady(): Promise<void> {
  return new Promise((resolve) => {
    if (document.readyState !== "loading") {
      resolve();
      return;
    }
    document.addEventListener("DOMContentLoaded", () => resolve(), {
      once: true,
    });
  });
}

/** Legacy tunnel behaviour: auto-mount unconditionally (writes via link secret). */
function autoMountTunnel(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mount());
  } else {
    mount();
  }
}

/**
 * Activate an embedded review session. The token has ALREADY been read + stripped
 * synchronously by `bootstrap()` before this async function runs. Fails closed
 * (no partial UI, no host-page throw) on any error.
 */
async function activateSession(
  boot: InjectedBootConfig,
  token: string | null,
  persisted: PersistedSession | null,
): Promise<void> {
  const { supabaseUrl, supabaseAnonKey, backendOrigin } = boot;
  // Without supabase url/key we cannot sign in, refresh, or write → stay dormant.
  if (!supabaseUrl || !supabaseAnonKey) return;

  let session: PersistedSession | null = null;
  try {
    if (token) {
      if (!backendOrigin) return; // cannot exchange → dormant
      // anon sign-in and the Turnstile challenge are independent, so run them
      // concurrently before the exchange (which needs both). getTurnstileToken
      // never throws (null in dev), so Promise.all only rejects on a sign-in
      // failure — caught below, fail-closed, exactly as the sequential path was.
      const [auth, turnstileToken] = await Promise.all([
        anonSignIn({ supabaseUrl, anonKey: supabaseAnonKey }),
        getTurnstileToken({ siteKey: boot.turnstileSiteKey }),
      ]);
      const exchanged = await exchangeReviewToken({
        backendOrigin,
        accessToken: auth.accessToken,
        token,
        turnstileToken,
      });
      session = {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        previewId: exchanged.previewId,
        role: exchanged.role,
        displayName: exchanged.displayName,
        expiresAt: auth.expiresAt,
      };
      persistSession(session);
    } else if (persisted && !isExpired(persisted.expiresAt)) {
      session = persisted;
    }
  } catch {
    // Token invalid/expired/reused, sign-in/exchange failed, or network error:
    // fail closed.
    return;
  }

  if (!session) return;

  // Refresh-before-write: read the bearer at submit time, refreshing it when it
  // is within REFRESH_SKEW_MS of expiry. Persist the rotated tokens.
  let current = session;
  const getAccessToken = async (): Promise<string> => {
    if (
      current.refreshToken &&
      isExpired(current.expiresAt, Date.now(), REFRESH_SKEW_MS)
    ) {
      try {
        const refreshed = await refreshAccessToken({
          supabaseUrl,
          anonKey: supabaseAnonKey,
          refreshToken: current.refreshToken,
        });
        current = {
          ...current,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
        };
        persistSession(current);
      } catch {
        // Refresh failed: fall through with the current token; the write may
        // 401 and surface a normal submit error.
      }
    }
    return current.accessToken;
  };

  const submitter = new SessionCommentSubmitter({
    supabaseUrl,
    supabaseAnonKey,
    previewId: session.previewId,
    getAccessToken,
  });

  // U13/U7: the modified-state raster is uploaded out-of-band to the private
  // `captures` bucket via the SAME session creds (RLS authorizes via the
  // review_sessions row); the comment stores only the returned ref. The real
  // DOM→image serializer is still real-env — until it is wired, screenshots are
  // the element-subtree DOM snapshot (not an image), which this skips uploading.
  const uploader = new CaptureUploader({
    supabaseUrl,
    supabaseAnonKey,
    previewId: session.previewId,
    getAccessToken,
  });

  // U12 (read-on-activate): start loading the preview's existing comments NOW,
  // concurrently with DOM-ready, so the network round-trip overlaps document
  // parsing instead of waiting until after mount. Fail-closed: a read failure
  // resolves to null and leaves the overlay write-only — it NEVER throws into
  // the host page or blocks the write path.
  const commentsPromise = loadReviewComments({
    supabaseUrl,
    supabaseAnonKey,
    previewId: session.previewId,
    getAccessToken,
  }).catch(() => null);

  await whenDomReady();

  const controller = mount({
    previewId: session.previewId,
    // sessionStorage is origin-scoped; namespace the cosmetic guest-name store
    // by host like the tunnel path does.
    previewKey: typeof location !== "undefined" ? location.host : "preview",
    submitter,
    uploader,
    storage: prefilledNameStorage(session.displayName),
  });

  // Render the markers once the (already in-flight) read resolves.
  void commentsPromise.then((comments) => {
    if (comments) controller.loadExistingComments(toExistingMarkers(comments));
  });
}

/**
 * Pre-fill the cosmetic guest-name field with the session's server-authoritative
 * display name so the reviewer does no setup (R4). Writes still go to real
 * localStorage; reads fall back to the display name only when nothing is stored.
 * (The server derives the authoritative display name from the session anyway —
 * this is purely so the overlay does not prompt for a name.)
 */
function prefilledNameStorage(displayName: string): NameStorage {
  return {
    getItem: (key) => {
      try {
        const stored = localStorage.getItem(key);
        if (stored) return stored;
      } catch {
        // privacy mode: fall through to the session display name
      }
      return displayName;
    },
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // ignore quota / privacy errors
      }
    },
  };
}

/**
 * The dormant-by-default entry. Tunnel mode (link secret present) keeps the old
 * unconditional auto-mount. Embedded mode reads + strips the token synchronously
 * and only activates when there is a token or an unexpired persisted session.
 */
function bootstrap(): void {
  // DEVICE-MODE CHILD: this document is loaded inside the responsive device
  // iframe; the parent overlay mounts a controller against it explicitly, so
  // the iframe's own bundle must NOT auto-mount (prevents a nested overlay).
  if (typeof location !== "undefined" && isDeviceChild(location.search)) {
    return;
  }

  const boot = window.__SUPERCOMMENT__ || {};

  // TUNNEL MODE: a link secret means the dev is proxying their own app.
  if (boot.linkSecret) {
    autoMountTunnel();
    return;
  }

  // EMBEDDED MODE.
  // 1) SYNCHRONOUS token read + strip — BEFORE any async/await below.
  const token = readTokenFromHash(location);
  if (token) {
    stripTokenFromHash({ location, history });
  }

  // 2) Dormant unless there is a token or an unexpired persisted session.
  const persisted = restoreSession();
  const haveLiveSession = !!persisted && !isExpired(persisted.expiresAt);
  if (!token && !haveLiveSession) {
    if (persisted) clearSession(); // tidy an expired session
    return; // DORMANT: mount nothing, bind nothing.
  }

  // 3) Activate asynchronously (token already stripped synchronously above).
  void activateSession(boot, token, persisted);
}

// Expose the API for tests / standalone use and run the dormant-gated bootstrap.
if (typeof window !== "undefined") {
  window.SuperCommentOverlay = { mount };
  if (typeof document !== "undefined") {
    bootstrap();
  }
}

export { OverlayController, mount };
export type { OverlayConfig };
