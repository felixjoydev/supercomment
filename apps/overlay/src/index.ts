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
 *        persist it (localStorage, origin-stamped) → mount with the
 *        `SessionCommentSubmitter` (writes authorize via the anon session JWT,
 *        NOT anon-key + link secret).
 *     4. With no token, the persisted session is restored and re-mounted — on
 *        reload (which triggers redeploy-reconcile) AND after same-origin
 *        navigation or in a newly-opened tab, since localStorage is shared
 *        across tabs. A session stored for a different origin is refused.
 *
 * Seams (overridable via `mount(config)`): `ContextCapturer` (U7) and
 * `CommentSubmitter` (see `core/types.ts`).
 */
import { OverlayController } from "./controller.js";
import { StubCommentSubmitter } from "./core/stubs.js";
import { RealContextCapturer } from "./capture/index.js";
import { domToCanvas, domToPng } from "modern-screenshot";
import { createLiveRasterizer, type DomToPng } from "./capture/rasterize-live.js";
import { createRegionRasterizer, type DomToCanvas } from "./capture/region.js";
import { submitterFromBootConfig } from "./submit/index.js";
import { SessionCommentSubmitter } from "./submit/session.js";
import { makeSetGuestEmail } from "./submit/email.js";
import { SessionAgentEnqueuer } from "./submit/enqueue.js";
import { CaptureUploader } from "./submit/upload.js";
import { SessionThreadClient } from "./submit/thread.js";
import {
  filterCommentsForPage,
  loadReviewComments,
  toExistingMarkers,
} from "./read/load-comments.js";
import { isDeviceChild } from "./device/device-mode.js";
import {
  REFRESH_SKEW_MS,
  anonSignIn,
  clearSession,
  exchangeReviewToken,
  getTurnstileToken,
  hasRestorableSession,
  isExpired,
  persistSession,
  readTokenFromHash,
  refreshAccessToken,
  restoreSession,
  shouldRefreshOnRestore,
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
/**
 * Assemble the full OverlayConfig from a caller's partial overrides, filling the
 * required fields with computed defaults. Exported for tests: this assembly once
 * silently dropped the comment-thread seams `threadClient` + `currentUser` (it was
 * built field-by-field and nobody added the two new keys), so every embedded
 * popover got no thread client and degraded to read-only (no reply box, mark-done,
 * or delete). It now forwards EVERY seam the caller passed via spread, so a newly
 * added config field can never be silently dropped again.
 */
export function buildMountConfig(
  overrides: Partial<OverlayConfig> = {},
): OverlayConfig {
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

  return {
    ...overrides,
    previewId,
    previewKey,
    submitter,
    // The live PNG rasterizer is wired ONLY in embedded activation (below), where
    // an uploader offloads the image out-of-band. Tunnel/standalone mounts get the
    // plain capturer, the small capped DOM-snapshot fallback (never an uncapped
    // inline PNG that would blow the guest `context` cap).
    capturer: overrides.capturer ?? new RealContextCapturer(),
  };
}

function mount(overrides: Partial<OverlayConfig> = {}): OverlayController {
  return new OverlayController(buildMountConfig(overrides));
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
  // Backend coordinates: prefer THIS page's boot config, but fall back to the
  // creds cached in the persisted session (restore path) so the toolbar re-mounts
  // on a later page / new tab even when that page did not re-inject the boot
  // config — only the overlay bundle needs to have loaded there. All public.
  const supabaseUrl = boot.supabaseUrl ?? persisted?.supabaseUrl;
  const supabaseAnonKey = boot.supabaseAnonKey ?? persisted?.supabaseAnonKey;
  const backendOrigin = boot.backendOrigin ?? persisted?.backendOrigin;
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
        // Phase 2: whether this member session may send to the coding agent.
        canSendToAgent: exchanged.canSendToAgent,
        expiresAt: auth.expiresAt,
        // Stamp the activation origin so a restore on a different origin is
        // refused (domain guard); localStorage is already origin-scoped.
        ...(typeof location !== "undefined" ? { origin: location.origin } : {}),
        // Cache the (public) backend coords so a restore on a later same-origin
        // page is self-contained even if that page lacked the boot config.
        supabaseUrl,
        supabaseAnonKey,
        ...(backendOrigin ? { backendOrigin } : {}),
      };
      persistSession(session);
    } else if (persisted) {
      // No token: restore the persisted session. If its access token is expired
      // or within the refresh skew, trade the refresh token for a fresh one NOW
      // so the toolbar re-activates after a long idle + navigation (up to the
      // refresh token's own lifetime); fail closed if the refresh token is dead.
      if (shouldRefreshOnRestore(persisted)) {
        try {
          const refreshed = await refreshAccessToken({
            supabaseUrl,
            anonKey: supabaseAnonKey,
            refreshToken: persisted.refreshToken,
          });
          session = {
            ...persisted,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          };
          persistSession(session);
        } catch {
          clearSession(); // refresh token expired/invalid → review session over
          return;
        }
      } else {
        session = persisted;
      }
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

  // Phase 2: the editor's "Send to agent" enqueues a saved template via the same
  // session creds; the enqueue_review_comment RPC re-verifies the member session
  // + grant server-side. Only actually offered when the session carries the grant.
  const enqueuer = new SessionAgentEnqueuer({
    supabaseUrl,
    supabaseAnonKey,
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
    // localStorage is origin-scoped; namespace the cosmetic guest-name store
    // by host like the tunnel path does.
    previewKey: typeof location !== "undefined" ? location.host : "preview",
    submitter,
    uploader,
    // Phase 2: carry the member's send-to-agent grant into the editor footer.
    canSendToAgent: session.canSendToAgent === true,
    enqueuer,
    // Comment threads (0033): reply / mark-done / delete from the pin popover.
    threadClient: new SessionThreadClient({
      supabaseUrl,
      supabaseAnonKey,
      getAccessToken,
    }),
    currentUser: { displayName: session.displayName, role: session.role },
    // U11: persist a guest's captured email server-side (set_guest_email, 0036) so
    // read-state keys to it; best-effort, never blocks the submit.
    captureGuestEmail: makeSetGuestEmail({
      supabaseUrl,
      supabaseAnonKey,
      previewId: session.previewId,
      getAccessToken,
    }),
    // U12: the Pages popover reloads the preview's comments each open (fresh
    // snapshot); fail-closed to an empty list so it never throws into the page.
    loadComments: () =>
      loadReviewComments({
        supabaseUrl,
        supabaseAnonKey,
        previewId: session.previewId,
        getAccessToken,
      }).catch(() => []),
    // U18: Exit clears the persisted review session so the overlay stays dormant
    // on reload / navigation; the controller tears its own UI down.
    onExit: () => clearSession(),
    // Embedded-only: capture a real PNG of the (modified) page, cropped to the
    // selected region, with the overlay + other pins excluded and this target
    // outlined. The uploader above offloads it to Storage so it never inflates
    // `context`; on any failure it falls back to the element DOM snapshot.
    capturer: new RealContextCapturer({
      screenshot: {
        rasterizeRegion: createRegionRasterizer(
          domToCanvas as unknown as DomToCanvas,
        ),
        rasterize: createLiveRasterizer(domToPng as unknown as DomToPng),
      },
    }),
    storage: prefilledNameStorage(session.displayName),
  });

  // Render the markers once the (already in-flight) read resolves — scoped to
  // THIS page. A review link can span a whole site, but a comment belongs to the
  // page it was made on (context.url), so comments from other routes must not
  // render here (their markers would mis-anchor or show as stale clutter).
  void commentsPromise.then((comments) => {
    if (!comments) return;
    // Seed the Pages popover cache with the full (all-pages) load so it has a
    // fallback if a later reload-on-open lapses (U12).
    controller.seedPages(comments);
    const forThisPage =
      typeof location !== "undefined"
        ? filterCommentsForPage(comments, location.href)
        : comments;
    controller.loadExistingComments(toExistingMarkers(forThisPage));
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

/** How the overlay may activate on this page load (R18/R21). */
export type BootMode = "tunnel" | "embedded" | "dormant";

/**
 * The activation GATE (R18/R21, G23): given the page's boot config, the review
 * token in the URL, and any persisted session, decide whether — and how — the
 * overlay activates. Every editor / upload / capture listener mounts ONLY for a
 * non-`dormant` result, so a bare production page (no link secret, no token, no
 * live session) stays completely inert. Pure + exported so the gate is locked by
 * a test — a regression that activated the editor on a production page would
 * flip this to `embedded`.
 */
export function evaluateBoot(input: {
  linkSecret?: string | null;
  token: string | null;
  hasLiveSession: boolean;
}): BootMode {
  if (input.linkSecret) return "tunnel";
  if (input.token || input.hasLiveSession) return "embedded";
  return "dormant";
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

  // SYNCHRONOUS token read + strip — BEFORE any async/await below (embedded
  // mode). A tunnel / production page carries no `#sc_token`, so this is a no-op
  // there; reading it up-front lets the single gate below decide the mode.
  const token = readTokenFromHash(location);
  if (token) {
    stripTokenFromHash({ location, history });
  }

  // Restore any persisted session for THIS origin (localStorage, shared across
  // tabs). Passing the current origin enforces the domain guard: a session
  // stored for another origin is refused.
  const currentOrigin =
    typeof location !== "undefined" ? location.origin : undefined;
  const persisted = restoreSession(undefined, currentOrigin);
  // Restorable = access token still valid OR a refresh token we can trade in;
  // activateSession does the refresh and fails closed if it's dead too. This is
  // what lets the toolbar survive a long idle + navigation, not just the ~1h
  // access-token window.
  const haveLiveSession = hasRestorableSession(persisted);

  // THE GATE. Editor / upload / capture listeners mount ONLY past this point.
  const mode = evaluateBoot({
    linkSecret: boot.linkSecret,
    token,
    hasLiveSession: haveLiveSession,
  });
  if (mode === "tunnel") {
    autoMountTunnel();
    return;
  }
  if (mode === "dormant") {
    if (persisted) clearSession(); // tidy an expired session
    return; // DORMANT: mount nothing, bind nothing.
  }

  // EMBEDDED: activate asynchronously (token already stripped synchronously).
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
