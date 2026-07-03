import { OVERLAY_Z_INDEX } from "./z-index.js";

/** Overlay styles — base section. Concatenated (in order) into OVERLAY_STYLES; do not edit the emitted string's bytes without re-verifying byte-identity. */
export const BASE_STYLES = `
:host {
  all: initial;
}
* {
  box-sizing: border-box;
}
.sc-layer {
  /* ── Quiet-gallery tokens ── */
  --ink: #231f18;
  --ink-2: #6e6759;
  --ink-3: #a29a8a;
  --surface: #ffffff;
  --soft: #f4f0e8;
  --line: rgba(35, 31, 24, 0.1);
  --line-strong: rgba(35, 31, 24, 0.16);
  --accent: #e0572b;
  --accent-deep: #bc4612;
  --accent-soft: rgba(224, 87, 43, 0.09);
  --accent-ring: rgba(224, 87, 43, 0.28);
  --shadow-float:
    0 0 0 1px rgba(35, 31, 24, 0.05),
    0 2px 4px rgba(35, 31, 24, 0.05),
    0 12px 28px rgba(35, 31, 24, 0.12),
    0 28px 60px rgba(35, 31, 24, 0.14);
  --shadow-card:
    0 0 0 1px rgba(35, 31, 24, 0.05),
    0 1px 2px rgba(35, 31, 24, 0.04),
    0 6px 16px rgba(35, 31, 24, 0.08);
  --shadow-xs: 0 0 0 1px rgba(35, 31, 24, 0.06), 0 1px 2px rgba(35, 31, 24, 0.06);
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);

  position: fixed;
  inset: 0;
  z-index: ${OVERLAY_Z_INDEX};
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  pointer-events: none;
}
.sc-layer > * {
  pointer-events: auto;
}
button {
  -webkit-tap-highlight-color: transparent;
}
button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

`;
