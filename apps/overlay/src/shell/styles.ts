/**
 * Overlay styles, scoped to the shadow root.
 *
 * Because all overlay DOM lives inside a shadow root (see `shell/root.ts`),
 * the host app's stylesheet cannot reach these nodes and these rules cannot
 * leak out (design-lens D-01 isolation). We still reset aggressively and pin a
 * very high z-index inside our own stacking context so we float above the host.
 *
 * This is an original SuperComment design (clean-room) — the same "quiet
 * gallery" language as the dashboard: warm ink, white pill surfaces, layered
 * shadows instead of borders, one persimmon accent. No third-party UI is
 * reproduced. System sans only: an injected tool must not load webfonts into
 * someone else's page.
 */

/** The fixed token for our root's stacking context. */
export const OVERLAY_Z_INDEX = 2147483000;

export const OVERLAY_STYLES = `
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

/* Toolbar -------------------------------------------------------------- */
.sc-toolbar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  box-shadow: var(--shadow-float);
  animation: sc-toolbar-in 480ms var(--ease-out) both;
}
@keyframes sc-toolbar-in {
  from {
    opacity: 0;
    transform: translate(-50%, 16px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }
}

/* Sliding active-mode indicator (vanilla layout-pill). */
.sc-mode-pill {
  position: absolute;
  top: 5px;
  left: 0;
  height: calc(100% - 10px);
  border-radius: 999px;
  background: var(--ink);
  will-change: transform, width;
}

.sc-mode-btn {
  position: relative;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  border-radius: 999px;
  padding: 8px 14px;
  font: inherit;
  font-weight: 550;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: color 180ms ease, transform 140ms var(--ease-out);
}
.sc-mode-btn > * {
  position: relative;
}
@media (hover: hover) and (pointer: fine) {
  .sc-mode-btn:hover:not([aria-pressed="true"]) {
    color: var(--ink);
  }
}
.sc-mode-btn:active {
  transform: scale(0.96);
}
.sc-mode-btn[aria-pressed="true"] {
  color: #ffffff;
}
.sc-mode-icon {
  display: inline-flex;
  width: 13px;
  height: 13px;
}
.sc-mode-icon svg {
  width: 100%;
  height: 100%;
}

.sc-toolbar-sep {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: var(--line);
}

/* Reviewer chip ------------------------------------------------------- */
.sc-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 8px;
  font-size: 12.5px;
  color: var(--ink-2);
  white-space: nowrap;
}
.sc-chip-name {
  font-weight: 600;
  color: var(--ink);
}
.sc-chip-change {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--accent-deep);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  padding: 5px 9px;
  border-radius: 999px;
  transition: background-color 160ms ease, transform 140ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .sc-chip-change:hover {
    background: var(--accent-soft);
  }
}
.sc-chip-change:active {
  transform: scale(0.96);
}

/* Multi confirm ------------------------------------------------------- */
.sc-multi-confirm {
  appearance: none;
  border: 0;
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  padding: 8px 16px;
  margin-left: 4px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background-color 160ms ease, transform 140ms var(--ease-out), opacity 160ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-multi-confirm:hover:not(:disabled) {
    background: #c94c22;
  }
}
.sc-multi-confirm:active:not(:disabled) {
  transform: scale(0.96);
}
.sc-multi-confirm:disabled {
  background: var(--soft);
  color: var(--ink-3);
  cursor: not-allowed;
}

/* Highlights / selection visuals -------------------------------------- */
.sc-highlight {
  position: fixed;
  border: 2px solid var(--accent);
  border-radius: 10px;
  background: var(--accent-soft);
  box-shadow: 0 0 0 4px rgba(224, 87, 43, 0.12);
  pointer-events: none;
}
.sc-area {
  position: fixed;
  border: 2px dashed var(--accent);
  border-radius: 6px;
  background: rgba(224, 87, 43, 0.06);
  pointer-events: none;
}

/* Comment form -------------------------------------------------------- */
.sc-form {
  position: fixed;
  width: 324px;
  padding: 16px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sc-form textarea {
  width: 100%;
  min-height: 76px;
  resize: vertical;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  border-radius: 12px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13.5px;
  color: var(--ink);
  background: var(--surface);
  transition: box-shadow 160ms ease;
}
.sc-form textarea::placeholder {
  color: var(--ink-3);
}
.sc-form textarea:focus {
  outline: none;
  box-shadow: inset 0 0 0 1.5px var(--accent), 0 0 0 3px var(--accent-ring);
}
.sc-field-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  margin-bottom: 5px;
}
.sc-segmented {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--soft);
}
.sc-seg {
  flex: 1;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  border-radius: 999px;
  padding: 5px 4px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  text-transform: capitalize;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}
.sc-seg[aria-pressed="true"] {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-xs);
}
.sc-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}
.sc-btn-secondary {
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  background: var(--surface);
  color: var(--ink);
  border-radius: 999px;
  padding: 8px 14px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 160ms ease, transform 140ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .sc-btn-secondary:hover {
    background: rgba(35, 31, 24, 0.04);
  }
}
.sc-btn-secondary:active {
  transform: scale(0.96);
}
.sc-btn-primary {
  appearance: none;
  border: 0;
  background: var(--ink);
  color: #fff;
  border-radius: 999px;
  padding: 8px 16px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, transform 140ms var(--ease-out), opacity 160ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-btn-primary:hover:not(:disabled) {
    background: #3a342a;
  }
}
.sc-btn-primary:active:not(:disabled) {
  transform: scale(0.96);
}
.sc-btn-primary:disabled {
  background: var(--soft);
  color: var(--ink-3);
  cursor: not-allowed;
}

/* Guest modal --------------------------------------------------------- */
.sc-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(35, 31, 24, 0.32);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sc-modal {
  width: 324px;
  padding: 24px;
  border-radius: 20px;
  background: var(--surface);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sc-modal h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.sc-modal-hint {
  font-size: 13px;
  color: var(--ink-2);
}
.sc-modal input {
  border: 0;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  border-radius: 12px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13.5px;
  color: var(--ink);
  transition: box-shadow 160ms ease;
}
.sc-modal input::placeholder {
  color: var(--ink-3);
}
.sc-modal input:focus {
  outline: none;
  box-shadow: inset 0 0 0 1.5px var(--accent), 0 0 0 3px var(--accent-ring);
}

/* Markers ------------------------------------------------------------- */
.sc-marker {
  position: fixed;
  width: 26px;
  height: 26px;
  margin: -13px 0 0 -13px;
  border-radius: 50% 50% 50% 4px;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 2px #fff, 0 4px 14px rgba(224, 87, 43, 0.45);
  cursor: pointer;
  transition: transform 160ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .sc-marker:hover {
    transform: scale(1.12);
  }
}
.sc-marker.sc-cluster {
  background: var(--ink);
  border-radius: 13px;
  box-shadow: 0 0 0 2px #fff, 0 4px 14px rgba(35, 31, 24, 0.4);
}
/* U12: an existing comment whose element could not be confidently re-anchored on
   the current deploy (U8 sets this from anchor corroboration). Visually distinct
   — muted + dashed ring — but still visible: stale comments stay until resolved. */
.sc-marker.sc-stale {
  background: var(--muted, #8a8578);
  box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(138, 133, 120, 0.5);
  opacity: 0.9;
}
.sc-edge.sc-stale {
  background: var(--muted, #8a8578);
}
.sc-edge {
  position: fixed;
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background: var(--ink);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 2px #fff, 0 4px 12px rgba(35, 31, 24, 0.4);
}

/* Reduced motion ------------------------------------------------------ */
@media (prefers-reduced-motion: reduce) {
  .sc-toolbar {
    animation: none;
  }
  .sc-mode-btn,
  .sc-chip-change,
  .sc-multi-confirm,
  .sc-btn-primary,
  .sc-btn-secondary,
  .sc-marker {
    transition-duration: 0ms;
  }
}
`;
