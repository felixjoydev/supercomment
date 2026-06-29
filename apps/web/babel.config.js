/*
 * SuperComment source-stamp wiring (U5) — DOGFOODING the customer-side plugin.
 * ===========================================================================
 *
 * This file makes `@supercomment/source-stamp` stamp JSX with
 * `data-sc-source="file:line:col"` so the overlay can capture exact code
 * locations on this app. It is the SAME wiring a customer adds to their own
 * preview build (see docs/embed/install.md).
 *
 * ESM, not CJS: apps/web is `"type": "module"`, so this `.js` file is an ES
 * module — hence `export default` (a `module.exports` version would throw). A
 * typical Next app (no `"type": "module"`) uses the CommonJS form shown in the
 * install docs, or names the file `babel.config.cjs`.
 *
 * SWC-vs-Babel tradeoff (Next 16 / Turbopack)
 * -------------------------------------------
 * Next 16 Turbopack AUTO-runs Babel as soon as a Babel config file is detected
 * (`turbopackUseBuiltinBabel`); SWC still handles Next's internal transforms +
 * downleveling. Running Babel is slower than the pure-SWC path, so we keep it
 * effectively OFF unless we are in a preview build:
 *
 *   - Preview (stamping ON):  `{ presets: ['next/babel'], plugins: [stamp] }`
 *       `next/babel` guarantees Babel can parse/transform TSX so our plugin's
 *       JSXOpeningElement visitor reliably sees JSX.
 *   - Otherwise (stamping OFF): `{}` — an empty config so Turbopack does no
 *       Babel work and SWC drives the build, keeping prod/dev unstamped and at
 *       full SWC speed.
 *
 * Production safety: production builds get NO stamp plugin here, AND
 * next.config.ts strips any stray `data-sc-source` via
 * `compiler.reactRemoveProperties` as a belt-and-suspenders backstop.
 *
 * Gating env (kept in sync with next.config.ts):
 *   - NEXT_PUBLIC_VERCEL_ENV === 'preview'  (Vercel preview deploys), or
 *   - SC_SOURCE_STAMP === '1'               (manual opt-in, e.g. local embed test).
 *
 * !! REAL-ENV (U11 finalizes): confirm against an actual `next build` that
 *    (a) preview output contains data-sc-source and (b) production output does
 *    not; and verify whether `turbopackUseBuiltinBabel` must be explicitly
 *    enabled on the deployed Next version, and that the empty-config OFF branch
 *    keeps Turbopack on SWC without a parse regression. Customers should scope
 *    this file (or its plugin branch) to PREVIEW builds only.
 */

const STAMP =
  process.env.SC_SOURCE_STAMP === "1" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

export default function babelConfig(api) {
  // Cache the result per gating state so Babel doesn't recompute per file but
  // still flips correctly between preview and non-preview builds.
  if (api && api.cache && typeof api.cache.using === "function") {
    api.cache.using(() => (STAMP ? "sc-stamp" : "sc-nostamp"));
  }

  if (!STAMP) {
    // No Babel work -> Turbopack keeps using SWC; nothing is stamped.
    return {};
  }

  // Babel resolves the plugin by name relative to this config's directory
  // (apps/web), where it is a workspace devDependency.
  return {
    presets: ["next/babel"],
    plugins: ["@supercomment/source-stamp"],
  };
}
