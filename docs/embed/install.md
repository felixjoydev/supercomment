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
