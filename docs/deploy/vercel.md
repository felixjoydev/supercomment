# Deploying SuperComment to Vercel

This deploys the **SuperComment app** (`apps/web`) — the dashboard + the backend that
serves `/sc-loader`, mints review tokens at `/s/<slug>`, exchanges them at
`/api/review-token/exchange`, and stores comments. Your customers never deploy this;
*you* host it once. A `*.vercel.app` subdomain is a real public `https` origin and is
**fine for now — no custom domain required.**

There are two apps in an end-to-end test:
1. **SuperComment** (`apps/web`) → one `*.vercel.app`.
2. **The site being reviewed** (any app with the snippet) → its own `https` origin.

---

## 1. Deploy SuperComment (`apps/web`)

### Vercel project settings
- **Root Directory:** `apps/web` (Vercel auto-detects Next.js + the pnpm workspace).
- **Framework Preset:** Next.js.
- **Install / Build / Output:** leave as defaults. `next build` runs the `prebuild` hook
  (`scripts/copy-overlay.mjs`), which **builds the overlay if its bundle is missing**
  (`ensureOverlayBuilt()`) and copies the hashed IIFE into `public/sc/`. So the overlay
  build order is self-contained — no `turbo.json`/`vercel.json` needed.
- **Node:** 20+ (root `engines` already pins this).

### Environment variables (Production + Preview)
Mirror `apps/web/.env.local`. Required:

| Var | Value | Notes |
|-----|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://uuldjrdrlwcgsiuknoor.supabase.co` | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon/publishable key | public; RLS is the security boundary |
| `NEXT_PUBLIC_APP_URL` | the deployed origin, e.g. `https://supercomment-xxx.vercel.app` | so `/s` links + `/sc-loader` resolve to the right host |

Optional (recommended once guest links are shared publicly):

| Var | Value | Notes |
|-----|-------|-------|
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret | **server-only — never `NEXT_PUBLIC`.** If unset, the token exchange skips verification (fine for a first demo). |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | matching Turnstile site key | paired with the secret |

**Do NOT set** a `service_role` key — the web app never uses one (fully anon-key + RLS).
`NEXT_PUBLIC_VERCEL_ENV` is set by Vercel automatically.

### Chicken-and-egg with `NEXT_PUBLIC_APP_URL`
You don't know the URL until the first deploy. Either: deploy once, copy the assigned
`*.vercel.app` domain, set `NEXT_PUBLIC_APP_URL` to it, and redeploy — or assign a stable
project domain first and use that.

### Supabase
Anonymous sign-ins are already enabled (embedded reviewers anon-auth before the token
exchange). If Supabase Auth rejects the new origin, add the `*.vercel.app` URL under
Auth → URL Configuration. The exchange route sets its own CORS.

---

## 2. The site being reviewed

1. Paste the snippet into the site (ideally a **preview/staging** build for `file:line`):
   ```html
   <script src="https://<your-supercomment-vercel-url>/sc-loader" async></script>
   ```
2. Deploy that site to its own `https` origin (`*.vercel.app` is fine).
3. In the SuperComment dashboard, open the project's **review link** → set **Deploy URL**
   to that site's `https` URL (must be public https — no localhost/IP).

---

## 3. Test end-to-end

1. On the review-link page, turn **Guest link** on and copy the link
   (`…/s/<slug>?k=<secret>`).
2. Open it (incognito = act as a reviewer). It redirects to your Deploy URL with the
   comment toolbar on top.
3. Leave a comment → it appears under **Comments** in the dashboard.
4. **Refresh the reviewed site** → the comment persists and re-renders (proves the
   token→session + read-back path).

---

## Gotchas
- **Build order** — handled by `ensureOverlayBuilt()`; nothing to configure.
- **`NEXT_PUBLIC_APP_URL` must equal the real origin**, or the review link / `/sc-loader`
  point at the wrong host.
- **Never expose** `TURNSTILE_SECRET_KEY` (or any service key) via a `NEXT_PUBLIC_*` var.
- **Localhost can't be a Deploy URL** by design (allowlist blocks it) — that's why this
  Vercel path exists instead of a localhost test.
