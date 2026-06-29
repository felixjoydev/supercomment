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

That's it. `/sc-loader` returns a tiny, always-fresh snippet that injects the
current overlay bundle from
`https://<supercomment-host>/sc/overlay.<hash>.global.js`. The bundle is
content-hashed and served with immutable caching, so upgrades are instant and
safe — only the small loader is re-fetched, never the cached bundle.

### What it does (and doesn't) do yet

- Loads the overlay code onto the page. The overlay stays **dormant** until a
  review session is activated via a share link. _(Activation lands in a later
  unit — U3.)_
- It does **not** activate for your end users on its own. Gate it out of
  production anyway — see below.

## Environment gating (important)

Only ship the snippet to non-production builds. A minimal guard:

```tsx
// Example: Next.js root layout — preview/staging only.
{process.env.NEXT_PUBLIC_VERCEL_ENV !== "production" && (
  <script src="https://<supercomment-host>/sc-loader" async />
)}
```

> **See U11 (production-safety gating) for the complete story.** U11 owns the
> full env-gating matrix _and_ the Content-Security-Policy guidance you'll need:
> `script-src` / `connect-src` for the overlay, plus
> `script-src` / `frame-src challenges.cloudflare.com` for Turnstile, and the
> `strict-dynamic` / `default-src` materialization gotchas. This file is the
> delivery floor only — it intentionally does not implement gating or CSP.

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

> If your app's `package.json` sets `"type": "module"`, this `.js` file is an ES
> module: use `export default function (api) { … }`, reference the plugin by
> name (`plugins: ["@supercomment/source-stamp"]`) instead of `require.resolve`,
> or name the file `babel.config.cjs`.

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
> entries beyond the overlay's own. The complete CSP guidance (overlay +
> Turnstile) lands with **U11 (production-safety gating)** — see that section
> when it ships.

## How delivery works

| URL | Cache | Purpose |
| --- | --- | --- |
| `/sc-loader` | `no-store` | Stable entry point your `<script>` points at; injects the current bundle. |
| `/sc/overlay.<hash>.global.js` | `public, max-age=31536000, immutable` | The content-hashed overlay IIFE (global `SuperCommentOverlay`). |

The hash changes whenever the overlay changes, so customers always get the
latest overlay without editing their snippet and without stale-cache risk. The
loader is loaded with a plain cross-origin `<script src>`, which executes
without any CORS headers; the cross-origin **fetch** surface (token mint /
exchange) is a separate concern handled in U2/U3.

### Build / deploy note

The bundle is produced by the overlay build and copied into the web app's
`public/sc/` by `apps/web`'s `prebuild` step (`scripts/copy-overlay.mjs`), which
runs automatically before `next build`. The prebuild builds the overlay first if
its output is missing, so the web build is self-contained. For local embedded
testing under `next dev`, run it once by hand:

```sh
node apps/web/scripts/copy-overlay.mjs
```
