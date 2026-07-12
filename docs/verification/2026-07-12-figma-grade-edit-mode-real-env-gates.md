---
date: 2026-07-12
topic: figma-grade-edit-mode
unit: U17 (real-env verification matrix + runbook)
status: PENDING (gates authored; live execution outstanding)
---

# Figma-Grade Edit Mode — real-env verification runbook

Manual real-env gates for the figma-grade-edit-mode round
(`docs/plans/2026-07-11-001-feat-figma-grade-edit-mode-plan.md`, U1–U16 built on
`feat/supercomment-mvp`; overlay manifest hash `ce512cfee932c337`). These cover
what the 1544 in-memory unit tests structurally cannot: real `getComputedStyle`
/ canvas / `document.fonts` / `FontFace`, live Storage RLS + the signed-URL round
trip, cross-origin fetch, an ancestor-scaled/oklch/CSS-var page, and device mode.

**Status: the gate matrix below is authored but NOT yet run live.** Every row's
Result is `PENDING`. Fill in `PASS`/`FAIL` + Evidence as each is executed against
a real environment; do not mark a row green without an observed result.

## How to run

Two harnesses, mirroring the house pattern
(`docs/verification/2026-07-07-agent-handoff-context-layers-real-env-gates.md`):

1. **Live save-to-MCP round trip** — a driver script
   `scripts/verify-edit-mode-live.mts` (to be added, following
   `scripts/verify-agent-handoff-live.mts`): SQL fixtures with cleanup, a member
   password-grant token, asserting `getComment` / `handleGetComment` return the
   new op fields end to end (font identity + signed font URL under the cap, token
   names, breakpoint tags, preview-unavailable markers, swap-URL provenance).
   ```
   SC_MEMBER_TOKEN_PATH=<path to {"access_token":"..."}> \
     arch -arm64 node_modules/.bin/tsx scripts/verify-edit-mode-live.mts
   ```
2. **Browser matrix** — the CDP recipe (`arch -arm64`, headless shell, per the
   `sandbox-arch-and-browser` memory): drive the overlay on the real host pages
   below and observe the DOM / recorded change-set. `Page.setBypassCSP` stays OFF
   for the CSP gate.

Live Supabase project: `uuldjrdrlwcgsiuknoor`. Migration `0051_font_uploads` is
already applied (advisors clean). Deploy per `overlay-deploy-pipeline`: the
manifest bump rides the overlay commits; poll `/sc-loader` until the hash flips.

## Gate matrix

Each gate names the AE(s) from the requirements doc it proves.

| Gate | AE | Host page / fixture | Steps | Expected | Result |
|---|---|---|---|---|---|
| 1 — cross-origin font catalog ACAO | AE3 | any real cross-origin host page (NOT our origin) | Overlay fetches `${backendOrigin}/sc/fonts-catalog.json` when the font picker opens | `200` with `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=3600, must-revalidate`; the specific rule WINS over the immutable `/sc/:file*` rule. A missing/incorrect ACAO fails loudly (picker shows page+generic only) | PENDING |
| 2 — Google font load + measureText attribution | AE3 | an oklch/Tailwind page using a webfont (e.g. Inter via next/font) | Open picker, pick Inter; observe detection + load | Detection lists the page's real families first; the mangled `__Inter_*` name normalizes to "Inter"; picking loads faces from `fonts.gstatic.com` only and re-renders text; `FontFace.status==="loaded"` gates attribution (a metric-adjusted `_Fallback` is not mistaken for the webfont) | PENDING |
| 3 — CSP-blocked font degradation | AE3 | a page whose CSP forbids `font-src`/`fonts.gstatic.com` | Pick a Google font | The `securitypolicyviolation` path labels a CSP block distinctly; the op records the clean family with `previewUnavailable`; the in-panel degradation badge shows; NO dangling preview | PENDING |
| 4 — document.fonts returns to baseline on discard | AE3 | any page + a loaded Google font | Load a font, then Discard all / exit | The session `FontRegistry` drains: `document.fonts` returns to its pre-session set (device-mode child docs included) | PENDING |
| 5 — uploaded font round trip | AE3 | a live guest review session | Upload a real woff2: sniff → instant `FontFace(bytes)` preview → Save → member `get_comment` | Sniff sets the true `font/woff2` type; preview renders instantly; at SAVE the file uploads to the `fonts` bucket (`<previewId>/<uuid>.woff2`); `getComment` returns the op with a signed `font.fileRef` URL under `MAX_RESOLVED_FONT_REFS`; a direct `fetch()` of that URL returns `200` | PENDING |
| 6 — discard leaves zero storage objects | AE3 | live session | Upload a font, then discard (never save) | The `fonts` bucket has NO new object for this preview (upload is deferred to save) | PENDING |
| 7 — server font caps + RLS | AE3 | live session (guest + member) | Attempt: a >10 MiB file; a renamed `.svg`/`.html`; direct-to-Storage POST past the per-preview object cap; cross-preview `fileRef` sign | Bucket rejects oversize + non-font mimes; `fonts_under_object_cap` refuses past the bound; `isPinnedFontRef` never signs a cross-preview ref; `get_advisors(security)` stays clean | PENDING |
| 8 — alpha-correct color on an oklch page | AE1 | a real oklch/Tailwind site | Open the color picker on a text element | The picker opens showing the TRUE color (oklch resolves via the canvas probe); the alpha slider writes the color's own alpha (`rgba`), element opacity untouched; hex/hex8/rgba entry round-trips | PENDING |
| 9 — page palette + eyedropper | AE1 | a real multi-color page (Chromium desktop) | Inspect the palette; use the eyedropper | The palette matches the page's visible colors, deduped on hex8; the eyedropper (feature-detected) picks a color and preserves the swatch's prior alpha | PENDING |
| 10 — design-token match (incl. dark theme) | AE6 | a CSS-variable site with a light/dark theme | Pick the exact brand color at a token | The "Matches --token" chip shows; the op carries `valueToken`; MCP prose names the token; on the dark theme the match uses the ELEMENT-resolved value, not the `:root` value | PENDING |
| 11 — 1:1 resize on scaled/sticky/transformed sections | AE4 | a page with `transform: scale()` / sticky / zoomed sections | Drag a resize handle | The box tracks the pointer 1:1 (ancestor-scale corrected); Shift locks aspect, Alt centers; one history entry per drag records explicit px width/height; a rotated ancestor degrades to panel inputs; no gesture dies from a chrome re-render | PENDING |
| 12 — drag-reorder on row/column/grid/wrapped | AE5 | a grid of cards + a wrapped flex row | Drag the reorder grip | The insertion line appears at valid slots on the right axis (2D for grid/wrapped); drop lands exactly at the line; undo restores order; hidden/absolute siblings are excluded but recorded indices are TRUE DOM indices; disconnect mid-drag aborts cleanly | PENDING |
| 13 — device-mode tagged edits + keepalive | AE9 | desktop + mobile editing session | Edit at base and at mobile; keep editing a while | Two correctly-tagged comments (base untagged, mobile `responsive:"mobile"`); the "Editing Mobile · 375px" chip renders; child-frame activity keeps the parent session alive (no lapse); no silent edit loss | PENDING |
| 14 — agent handoff completeness | AE3/AE6/AE9 | a template with font/token/breakpoint/swap/hide/move ops | `get_comment` for the template | One prose line per op, correct + human-readable: font identity + upload provenance, `use token --x`, `@mobile`, swap-URL provenance, preview-unavailable caveat; structured ops + a signed font URL under the caps; guest-image confirmation invariants unchanged | PENDING |
| 15 — polish/motion acceptance | R19 | Felix's own site | Use the editor end to end | Felix's origin bar: "works like Figma" — motion, scrubbing, refined controls feel designed; label scrub commits one entry with the final value | PENDING |
| 16 — deploy smoke | — | prod | Push the overlay commits; poll `/sc-loader` | The served hash flips to `ce512cfee932c337` (or the latest); the overlay boots on a real preview and the new controls appear | PENDING |

## Deferred items to fold into this pass

Carried from U14/U15 (built as core; these refinements are outstanding):

- **U14 confirm gate** — a preset switch OR parent exit with unsaved child-frame
  edits must raise a confirm (union of parent + child state); declining keeps the
  frame. Today a preset switch destroys the child (silent loss). Needs the
  `ChildController` seam widened to expose `hasUnsavedEdits()` + a confirm hook.
- **U14 per-surface prompt** — prompt text is per surface; each save carries its
  own.
- **U15 multi-element viewport raster** — a multi-element edit session should
  capture a VIEWPORT raster instead of a single-element crop (single-element
  sessions keep the region crop). Controller capture-scope change.

## Notes

- `arch -arm64` is required on this machine for the tsx/CDP paths
  (Rosetta/rollup native-binary mismatch — `sandbox-arch-and-browser` memory).
- The member access token is minted headless via the password grant against the
  dev account, per the `running-setup` memory; keep the token file OUTSIDE the
  repo (session scratchpad), never under `scripts/`.
- Fixtures for the live driver are created via SQL against the live DB in the dev
  account's own preview and cleaned up after (mirroring the U10 runbook's
  fixtures section); a real pre-existing `fonts` object may be reused rather than
  uploading a fresh binary where a signed-URL round trip is all that is asserted.
