# Embed the SuperComment overlay

Add visual review to your **deployed preview** with one line. Reviewers open a
share link and comment directly on the running app — nothing for them to install.

## Install (universal snippet)

Paste this into your app's HTML `<head>` (or your root layout), on **preview /
staging builds only** — never production (see [Environment gating](#environment-gating-important)):

```html
<script src="https://<supercomment-host>/sc-loader" async></script>
```

Replace `<supercomment-host>` with your SuperComment app host (for example
`https://app.supercomment.dev`).

That's it. `/sc-loader` returns a tiny, always-fresh snippet that (1) sets the
overlay boot config on `window.__SUPERCOMMENT__` and (2) injects the current
overlay bundle from `https://<supercomment-host>/sc/overlay.<hash>.global.js`. The
bundle is content-hashed and served with immutable caching, so upgrades are
instant and safe — only the small loader is re-fetched, never the cached bundle.

### What it does

- Delivers the overlay **boot config** (`window.__SUPERCOMMENT__` — Supabase URL +
  anon key, the SuperComment backend origin, and an optional Turnstile site key)
  and loads the overlay code onto the page.
- The overlay stays **dormant** until a reviewer activates a session by following
  a share link (`/s/<slug>`). With no valid token and no persisted review session
  it mounts nothing and binds no listeners — it never activates for your end users
  on its own.
- Gate it out of production anyway (defense in depth — see
  [Production safety](#production-safety-two-layers)).

## Environment variables (SuperComment host)

`/sc-loader` reads these from the **SuperComment app's own** environment at
request time and bakes them into the boot config it ships to the overlay. They
belong on the deployment that serves `/sc-loader` — **not** on the app you embed
the snippet in. All are public client values (the anon key is publishable; RLS is
the security boundary).

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL — the overlay's anon sign-in / token-refresh / RPC target. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon / publishable key (public by design). |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | optional | Cloudflare Turnstile **site** key. When set, the overlay produces an invisible Turnstile token for the session exchange; when unset, no token is sent (dev / demo). |

> `backendOrigin` is **not** an env var — `/sc-loader` derives it from its own
> request origin (the SuperComment host is the token-exchange backend). When
> Supabase URL/key are absent, the overlay stays dormant rather than erroring.

> **Never** put `service_role` or the Turnstile **secret** into any
> `NEXT_PUBLIC_*` value. Only the anon key and the Turnstile *site* key are
> client-safe. The Turnstile secret (`TURNSTILE_SECRET_KEY`, server-only) is read
> by the token-exchange endpoint, never shipped to the browser.

## Production safety (two layers)

The overlay must never reach your production end users (R18). Two independent
layers enforce this — neither alone is trusted.

### Layer 1 — build-time: include the snippet in preview/staging only

Only add the `<script src=".../sc-loader">` to **non-production** builds of your
app. A minimal Next.js guard in your root layout:

```tsx
// Example: Next.js root layout — preview/staging only.
{process.env.NEXT_PUBLIC_VERCEL_ENV !== "production" && (
  <script src="https://<supercomment-host>/sc-loader" async />
)}
```

As a backstop on the SuperComment side, `/sc-loader` is **itself inert on
production deploys** of the SuperComment host: when `NEXT_PUBLIC_VERCEL_ENV ===
"production"` it returns a no-op script (logs a console note, injects no overlay
and no boot config) instead of the bundle. If you intentionally run a non-public
staging environment as `production`, set `SUPERCOMMENT_ENABLE_IN_PROD=1` on the
SuperComment host to re-enable it.

### Layer 2 — runtime: dormant without a token

Even if the snippet somehow ships to production and the bundle loads, the overlay
stays **dormant** unless a valid review session is active. With no `#sc_token`
URL fragment and no persisted review session it mounts nothing and binds no
listeners. Activation happens only by following a `/s/<slug>` share link, which
mints a short-lived, single-use, preview-scoped token. The companion
`data-sc-source` build stamp is likewise preview-only and stripped from
production builds via `reactRemoveProperties` (see
[Enhanced code context](#enhanced-code-context-optional)).

## Content-Security-Policy (CSP)

If your app sends a `Content-Security-Policy`, allow the overlay's script and
network surfaces below. The overlay needs only host/nonce sources — **never add
`'unsafe-inline'`** (it would weaken your policy far beyond what's required).

| Directive | Add | Why |
| --- | --- | --- |
| `script-src` | `https://<supercomment-host>` | The `/sc-loader` snippet you include + the overlay bundle it injects. |
| `script-src` | `https://challenges.cloudflare.com` | Cloudflare Turnstile (only if a Turnstile site key is configured). |
| `connect-src` | `https://<supercomment-host>` | The cross-origin token exchange (`POST /api/review-token/exchange`). |
| `connect-src` | `https://<project-ref>.supabase.co` | Supabase anon sign-in / token refresh / comment read + write RPCs. Add the `wss://<project-ref>.supabase.co` form too if you rely on realtime. |
| `frame-src` | `https://challenges.cloudflare.com` | Turnstile renders its (invisible) challenge in a frame. |

A complete example for an app that otherwise locks everything down:

```
Content-Security-Policy:
  default-src 'self';
  script-src  'self' https://<supercomment-host> https://challenges.cloudflare.com;
  connect-src 'self' https://<supercomment-host> https://<project-ref>.supabase.co wss://<project-ref>.supabase.co;
  frame-src   https://challenges.cloudflare.com;
```

### Gotchas (hard-won)

- **`'strict-dynamic'` ignores host allow-lists.** If your `script-src` contains
  `'strict-dynamic'`, browsers **ignore** host sources like
  `https://<supercomment-host>` and run only scripts carrying a valid
  **nonce**/hash — plus the scripts those then inject. Put your per-request nonce
  on the SuperComment `<script>` tag; the bundle it injects inherits trust
  automatically. Adding the host to `script-src` does nothing under
  `'strict-dynamic'` — don't rely on it.
- **Materialize `script-src` / `connect-src` from `default-src` first.** CSP
  directives do **not** merge — a present `script-src` fully replaces the
  `default-src` fallback for scripts (same for `connect-src`). If today you set
  only `default-src`, create the explicit `script-src` / `connect-src` **seeded
  with your existing `default-src` sources**, *then* append the
  overlay / Supabase / Turnstile sources. Otherwise those become the *only*
  allowed sources and the rest of your app breaks.
- **Never add `'unsafe-inline'`.** The boot config ships inside the external
  `/sc-loader` script (not an inline `<script>`), so no inline allowance is
  needed.

## Enhanced code context (optional)

The universal snippet always captures a component path. For **React apps** you
can additionally capture exact `file:line` for the element a reviewer clicks, so
the AI hand-off points straight at the source.

React 19 / Next App Router removed the runtime source info that older tooling
read off the fiber, so the file location must be **stamped at build time**. The
`@supercomment/source-stamp` Babel plugin adds one attribute per JSX element:

```html
<div data-sc-source="src/components/Card.tsx:42:6">…</div>
```

The overlay reads the nearest `data-sc-source` via `el.closest()` at capture
time. This is **progressive enhancement** and **preview-only** — never stamp
production (the overlay never activates there, and you don't want source paths
shipped to end users).

### 1. Install

```sh
npm install --save-dev @supercomment/source-stamp
```

### 2. Wire it into Babel (preview builds only)

Next 16 Turbopack runs Babel automatically when it finds a Babel config. Gate
the plugin so it only runs in preview builds (`babel.config.js`):

```js
// babel.config.js
const STAMP =
  process.env.SC_SOURCE_STAMP === "1" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

module.exports = function (api) {
  api.cache.using(() => (STAMP ? "sc-stamp" : "sc-nostamp"));
  if (!STAMP) return {}; // SWC drives non-preview builds; nothing stamped.
  return {
    presets: ["next/babel"],
    plugins: [require.resolve("@supercomment/source-stamp")],
  };
};
```

> **If your app's `package.json` sets `"type": "module"`, name the file
> `babel.config.cjs`** (CommonJS, `module.exports = …`). As a `.js` file it is
> then treated as ESM, and Next's Babel loader `require()`s the config — which
> throws `require() of ES Module not supported` and breaks the build. A `.cjs`
> extension forces CommonJS regardless of `"type": "module"`. (This is exactly
> why the SuperComment app itself does not stamp its own source — it is the
> dashboard/backend, not a reviewed preview.)

> **SWC vs Babel:** a Babel config makes Turbopack run Babel (slower than the
> pure-SWC path). The empty `{}` returned for non-preview builds keeps Turbopack
> on SWC, so only preview builds pay the cost. Confirm against a real
> `next build` that preview output contains `data-sc-source` and production
> output does not.

### 3. Production backstop (`next.config.ts`)

Strip any stray stamp in non-preview builds as a safety net:

```ts
const SC_SOURCE_STAMP =
  process.env.SC_SOURCE_STAMP === "1" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

const nextConfig = {
  compiler: {
    // Rust regex syntax. `false` in preview keeps the attribute readable.
    reactRemoveProperties: SC_SOURCE_STAMP
      ? false
      : { properties: ["^data-sc-source$"] },
  },
};
```

> **CSP:** enabling enhanced context needs no extra Content-Security-Policy
> entries beyond the overlay's own — see [Content-Security-Policy](#content-security-policy-csp).

## How delivery works

| URL | Cache | Purpose |
| --- | --- | --- |
| `/sc-loader` | `no-store` | Stable entry point your `<script>` points at; sets the boot config + injects the current bundle (inert on production). |
| `/sc/overlay.<hash>.global.js` | `public, max-age=31536000, immutable` | The content-hashed overlay IIFE (global `SuperCommentOverlay`). |

The hash changes whenever the overlay changes, so customers always get the
latest overlay without editing their snippet and without stale-cache risk. The
loader is loaded with a plain cross-origin `<script src>`, which executes without
any CORS headers. The overlay's own cross-origin **fetch** surface — anon
sign-in + token exchange + comment read/write — is what your
[CSP `connect-src`](#content-security-policy-csp) must allow.

### Build / deploy note

The bundle is produced by the overlay build and copied into the web app's
`public/sc/` by `apps/web`'s `prebuild` step (`scripts/copy-overlay.mjs`), which
runs automatically before `next build`. The prebuild builds the overlay first if
its output is missing, so the web build is self-contained. For local embedded
testing under `next dev`, run it once by hand:

```sh
node apps/web/scripts/copy-overlay.mjs
```
