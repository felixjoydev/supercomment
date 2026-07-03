/**
 * Embedded review-mode session lifecycle (U3) — supabase-js-FREE.
 *
 * The overlay is shipped as a single self-contained IIFE injected into the
 * customer's deploy origin. It must NOT pull in @supabase/supabase-js (bloat +
 * collision risk with a host app that already ships it), so every network step
 * here is a raw `fetch` (anon sign-in, token exchange, refresh). All seams are
 * injectable so the pure parts (hash read/strip, persist/restore, expiry) are
 * unit-tested in node/jsdom and the live network is isolated.
 *
 * FLOW on the deploy origin (see index.ts for the orchestration):
 *   1. SYNCHRONOUSLY read `#sc_token=<token>` from the hash, then immediately
 *      `history.replaceState` to strip it — BEFORE any async/await — so it never
 *      lingers in the URL for error reporters / Referer.
 *   2. Anonymous sign-in (POST /auth/v1/signup) → anon access/refresh JWT.
 *   3. Exchange the token (POST /api/review-token/exchange, anon bearer) →
 *      { previewId, role, displayName }.
 *   4. Persist { tokens, previewId, role, displayName, expiresAt, origin } in
 *      localStorage and mount.
 *   5. Refresh (POST /auth/v1/token?grant_type=refresh_token) before a write
 *      when the access token is near expiry.
 *
 * This module is a BARREL over the per-concern chunks under ./session/:
 *   - token-hash   — read/strip the review token from the URL fragment
 *   - persistence  — persist/restore/clear + expiry/refresh decisions (localStorage)
 *   - network      — anon sign-in / exchange / refresh (raw fetch)
 *   - turnstile    — invisible Turnstile (U4) token acquisition
 * The public API is unchanged — every symbol the chunks export is re-exported
 * here, so consumers keep importing from `auth/session`.
 *
 * VERIFY IN REAL ENV: the live Supabase anon sign-in + refresh endpoints, the
 * cross-origin exchange POST (CORS), and the real Turnstile widget cannot be
 * exercised in this sandbox; they are isolated behind injectable seams.
 */
export * from "./session/token-hash.js";
export * from "./session/persistence.js";
export * from "./session/network.js";
export * from "./session/turnstile.js";
