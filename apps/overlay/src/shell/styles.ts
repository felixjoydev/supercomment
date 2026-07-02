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

/* Exit (U18) ---------------------------------------------------------- */
.sc-exit {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  padding: 5px 10px;
  margin-left: 2px;
  border-radius: 999px;
  transition: background-color 160ms ease, color 160ms ease, transform 140ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .sc-exit:hover {
    background: rgba(35, 31, 24, 0.04);
    color: var(--ink);
  }
}
.sc-exit:active {
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
.sc-btn-danger {
  appearance: none;
  border: 0;
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  padding: 8px 16px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, transform 140ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .sc-btn-danger:hover {
    background: var(--accent-deep);
  }
}
.sc-btn-danger:active {
  transform: scale(0.96);
}

/* Reference images (U17) ---------------------------------------------- */
.sc-ref {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sc-ref-add {
  appearance: none;
  border: 0;
  align-self: flex-start;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  background: var(--surface);
  color: var(--ink-2);
  border-radius: 999px;
  padding: 6px 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ref-add:hover { background: rgba(35, 31, 24, 0.04); color: var(--ink); }
}
.sc-ref-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sc-ref-thumb {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--shadow-xs);
}
.sc-ref-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sc-ref-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  background: rgba(35, 31, 24, 0.7);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sc-ref-error {
  font-size: 11.5px;
  color: var(--accent-deep);
}
.sc-ref-error:empty {
  display: none;
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
  pointer-events: auto;
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
/* U16 (R11): a visual-edit template pin — a rounded-square ink pin with an
   accent ring, distinct from the round persimmon comment pin. */
.sc-marker.sc-template {
  background: var(--ink);
  border-radius: 7px;
  box-shadow: 0 0 0 2px #fff, 0 0 0 3px var(--accent-ring), 0 4px 14px rgba(35, 31, 24, 0.4);
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

/* Comment popover ----------------------------------------------------- */
/* Opens when a pin is clicked: the reviewer reads the thread on the live
   deploy. Same quiet-gallery language as the form/modal — white surface,
   layered float shadow, warm ink, one persimmon accent. */
.sc-comment-pop {
  position: absolute;
  z-index: 1;
  max-width: 280px;
  min-width: 200px;
  width: max-content;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-float);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.5;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sc-comment-pop-close {
  position: absolute;
  top: 8px;
  right: 8px;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 160ms ease, color 160ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-comment-pop-close:hover {
    background: var(--soft);
    color: var(--ink);
  }
}
.sc-comment-entry {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sc-comment-entry + .sc-comment-entry {
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.sc-comment-head {
  font-weight: 600;
  color: var(--ink);
  padding-right: 22px;
}
.sc-comment-num {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.sc-comment-author {
  color: var(--ink-2);
  font-weight: 550;
}
.sc-comment-meta {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: capitalize;
  color: var(--accent-deep);
}
.sc-comment-tag {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.sc-comment-note {
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sc-comment-time {
  font-size: 11px;
  color: var(--ink-3);
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

/* Responsive device mode ---------------------------------------------- */
.sc-device-toolbar {
  position: fixed;
  top: 16px;
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
  z-index: 2;
}
.sc-device-tb-label {
  padding: 0 8px 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
  letter-spacing: 0.01em;
}
.sc-device-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  border-radius: 999px;
  padding: 7px 13px;
  font: inherit;
  font-weight: 550;
  font-size: 13px;
  cursor: pointer;
  transition: background 160ms var(--ease-out), color 160ms var(--ease-out);
}
.sc-device-btn:hover {
  background: var(--soft);
  color: var(--ink);
}
.sc-device-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sc-device-btn[aria-pressed="true"] {
  background: var(--ink);
  color: var(--surface);
}
.sc-device-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.sc-device-btn[aria-pressed="true"] .sc-device-count {
  background: var(--surface);
  color: var(--ink);
}

.sc-device-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(35, 31, 24, 0.34);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  z-index: 1;
  animation: sc-fade-in 200ms var(--ease-out) both;
}
@keyframes sc-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.sc-device-frame {
  position: relative;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 96px);
  background: var(--surface);
  border-radius: 18px;
  box-shadow: var(--shadow-float);
  overflow: hidden;
}
.sc-device-size {
  position: absolute;
  top: -26px;
  left: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--surface);
  opacity: 0.92;
}
.sc-device-iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--surface);
}

.sc-device-notice {
  position: fixed;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 360px;
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--ink);
  color: var(--surface);
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow-float);
  z-index: 3;
  animation: sc-fade-in 200ms var(--ease-out) both;
}

/* Visual editor — properties panel (editor redesign) ------------------- */
/* A dark, right-docked inspector. The dark theme is SCOPED to this panel — the
   toolbar, markers, and comment form stay in the light "quiet gallery" language.
   Clean-room original: it reproduces the reference's structure + feel, never any
   competitor's code or assets. */
.sc-edit-panel {
  /* Dark panel tokens (local; do not leak to the rest of the overlay). */
  --ep-bg: #1b1b20;
  --ep-header: #101014;
  --ep-field: #26262d;
  --ep-field-2: #303038;
  --ep-line: rgba(255, 255, 255, 0.075);
  --ep-line-2: rgba(255, 255, 255, 0.12);
  --ep-ink: #ededf2;
  --ep-ink-2: #a4a4ae;
  --ep-ink-3: #6d6d78;
  --ep-tag: #e93cac;
  --ep-accent: #8b6dff;
  --ep-accent-2: #7857ff;
  --ep-seg-active: #3a3a44;

  position: fixed;
  top: 16px;
  right: 16px;
  width: 300px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  border-radius: 16px;
  background: var(--ep-bg);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.5),
    0 20px 48px rgba(0, 0, 0, 0.45),
    0 4px 12px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  color: var(--ep-ink);
  font-variant-numeric: tabular-nums;
  animation: sc-panel-in 320ms var(--ease-out) both;
}
@keyframes sc-panel-in {
  from { opacity: 0; transform: translateX(12px) scale(0.98); }
  to { opacity: 1; transform: translateX(0) scale(1); }
}
.sc-edit-panel::-webkit-scrollbar { width: 10px; }
.sc-edit-panel::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  border: 3px solid var(--ep-bg);
}

/* Header — drag handle + tag badge + close. */
.sc-ep-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 12px;
  background: var(--ep-header);
  border-bottom: 1px solid var(--ep-line);
}
.sc-ep-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.sc-ep-handle {
  color: var(--ep-ink-3);
  font-size: 13px;
  line-height: 1;
  letter-spacing: -2px;
  cursor: grab;
  user-select: none;
}
.sc-ep-handle:active { cursor: grabbing; }
.sc-ep-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  background: var(--ep-tag);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.sc-ep-close {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ep-ink-3);
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  flex: none;
  transition: background-color 160ms ease, color 160ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-close:hover { background: var(--ep-field); color: var(--ep-ink); }
}

/* Sections — collapsible; a hairline divider between each. */
.sc-ep-section {
  padding: 14px 14px 16px;
  border-bottom: 1px solid var(--ep-line);
}
.sc-ep-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.sc-ep-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ep-ink-2);
}
.sc-ep-collapse {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ep-ink-3);
  width: 18px;
  height: 18px;
  border-radius: 5px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-collapse:hover { background: var(--ep-field); color: var(--ep-ink); }
}
.sc-ep-section-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sc-ep-section[data-collapsed="1"] .sc-ep-section-body { display: none; }

/* Rows + labels. */
.sc-ep-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sc-ep-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.sc-ep-label {
  font-size: 12.5px;
  color: var(--ep-ink-2);
  font-weight: 500;
  white-space: nowrap;
}

/* Fields (number / select / text). */
.sc-ep-number,
.sc-ep-select,
.sc-ep-hex {
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  border-radius: 8px;
  padding: 7px 9px;
  font: inherit;
  font-size: 12.5px;
  color: var(--ep-ink);
  background: var(--ep-field);
  transition: box-shadow 160ms ease, background-color 160ms ease;
}
.sc-ep-number { width: 100%; text-align: left; -moz-appearance: textfield; }
.sc-ep-number::-webkit-outer-spin-button,
.sc-ep-number::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.sc-ep-select {
  min-width: 132px;
  cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--ep-ink-3) 50%),
    linear-gradient(135deg, var(--ep-ink-3) 50%, transparent 50%);
  background-position: calc(100% - 15px) 12px, calc(100% - 10px) 12px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 26px;
}
.sc-ep-number:focus,
.sc-ep-select:focus,
.sc-ep-hex:focus {
  outline: none;
  box-shadow: inset 0 0 0 1.5px var(--ep-accent), 0 0 0 3px rgba(139, 109, 255, 0.25);
}
.sc-ep-number:disabled { color: var(--ep-ink-3); background: rgba(255, 255, 255, 0.03); }
.sc-ep-select option { background: var(--ep-field); color: var(--ep-ink); }

/* Number + stepper cluster. */
.sc-ep-num {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 132px;
}
.sc-ep-stepper {
  display: flex;
  flex-direction: column;
  flex: none;
  gap: 2px;
}
.sc-ep-step {
  appearance: none;
  border: 0;
  background: var(--ep-field);
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  color: var(--ep-ink-2);
  width: 20px;
  height: 12px;
  border-radius: 4px;
  font-size: 7px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 140ms ease, color 140ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-step:hover { background: var(--ep-field-2); color: var(--ep-ink); }
}

/* Segmented control (Row/Column, Padding/Margin, Alignment). */
.sc-ep-segmented {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 9px;
  background: var(--ep-field);
  box-shadow: inset 0 0 0 1px var(--ep-line);
}
.sc-ep-row-stack .sc-ep-segmented { width: 100%; }
.sc-ep-seg {
  flex: 1;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ep-ink-2);
  border-radius: 7px;
  padding: 6px 8px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
}
.sc-ep-seg[aria-pressed="true"] {
  background: var(--ep-seg-active);
  color: var(--ep-ink);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

/* Spacing — 2×2 side grid with box-side glyphs + a lock switch. */
.sc-ep-side-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.sc-ep-side {
  display: flex;
  align-items: center;
  gap: 4px;
  width: auto;
}
.sc-ep-side .sc-ep-number { width: 100%; padding-left: 26px; }
.sc-ep-side { position: relative; }
.sc-ep-side-glyph {
  position: absolute;
  left: 8px;
  width: 11px;
  height: 11px;
  border: 1px dotted var(--ep-ink-3);
  border-radius: 2px;
  pointer-events: none;
  z-index: 1;
}
.sc-ep-side-glyph-top { border-top: 1.5px solid var(--ep-ink); }
.sc-ep-side-glyph-right { border-right: 1.5px solid var(--ep-ink); }
.sc-ep-side-glyph-bottom { border-bottom: 1.5px solid var(--ep-ink); }
.sc-ep-side-glyph-left { border-left: 1.5px solid var(--ep-ink); }

/* Toggle switch (Lock). */
.sc-ep-switch {
  appearance: none;
  border: 0;
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: var(--ep-field-2);
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  cursor: pointer;
  transition: background-color 180ms var(--ease-out);
  flex: none;
}
.sc-ep-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  transition: transform 180ms var(--ease-out);
}
.sc-ep-switch[aria-checked="true"] { background: var(--ep-accent); }
.sc-ep-switch[aria-checked="true"]::after { transform: translateX(14px); }

/* Size — dimension row (number + Fixed/Auto). */
.sc-ep-dim-label {
  width: 18px;
  font-weight: 600;
  color: var(--ep-ink-2);
}
.sc-ep-num.sc-ep-ctl-width-wrap,
.sc-ep-num.sc-ep-ctl-height-wrap { width: 100px; flex: none; }
.sc-ep-dim-mode { min-width: 96px; flex: none; }

/* Position — place-self cross picker. */
.sc-ep-cross {
  position: relative;
  width: 118px;
  height: 92px;
  margin: 2px auto 0;
}
.sc-ep-cross::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(var(--ep-line-2), var(--ep-line-2)) center / 1px 100% no-repeat,
    linear-gradient(var(--ep-line-2), var(--ep-line-2)) center / 100% 1px no-repeat;
  opacity: 0.5;
}
.sc-ep-cross-dot {
  position: absolute;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  border: 1.5px solid var(--ep-line-2);
  background: var(--ep-field);
  cursor: pointer;
  padding: 0;
  transition: border-color 150ms ease, background-color 150ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-cross-dot:hover { border-color: var(--ep-accent); }
}
.sc-ep-cross-dot[aria-pressed="true"] {
  background: var(--ep-accent);
  border-color: var(--ep-accent);
}
.sc-ep-cross-top { top: 50%; left: 50%; transform: translateY(-32px); }
.sc-ep-cross-bottom { top: 50%; left: 50%; transform: translateY(32px); }
.sc-ep-cross-left { top: 50%; left: 50%; transform: translateX(-42px); }
.sc-ep-cross-right { top: 50%; left: 50%; transform: translateX(42px); }
.sc-ep-cross-center { top: 50%; left: 50%; }

/* Colour — swatch + hex + opacity. */
.sc-ep-colour-row { gap: 8px; }
.sc-ep-swatch {
  appearance: none;
  -webkit-appearance: none;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  background: transparent;
  cursor: pointer;
  flex: none;
}
.sc-ep-swatch::-webkit-color-swatch-wrapper { padding: 3px; }
.sc-ep-swatch::-webkit-color-swatch { border: 0; border-radius: 5px; }
.sc-ep-hex { flex: 1; min-width: 0; text-transform: uppercase; }
.sc-ep-opacity-wrap {
  position: relative;
  width: 72px;
  flex: none;
}
.sc-ep-opacity { width: 100%; padding-right: 22px; text-align: right; }
.sc-ep-opacity-pct {
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--ep-ink-3);
  pointer-events: none;
}

/* Arrange — functional reorder (requirement F). */
.sc-ep-arrange {
  display: flex;
  gap: 8px;
}
.sc-ep-btn {
  flex: 1;
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  background: var(--ep-field);
  color: var(--ep-ink);
  border-radius: 8px;
  padding: 7px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 150ms ease, transform 140ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-btn:hover { background: var(--ep-field-2); }
}
.sc-ep-btn:active { transform: scale(0.97); }

/* Footer — N edits · Undo · Save comment. */
.sc-ep-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: var(--ep-header);
  border-top: 1px solid var(--ep-line);
}
.sc-ep-count {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--ep-ink-2);
}
.sc-ep-undo {
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  background: transparent;
  color: var(--ep-ink);
  border-radius: 8px;
  padding: 8px 14px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 150ms ease, opacity 150ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-undo:hover:not(:disabled) { background: var(--ep-field); }
}
.sc-ep-undo:disabled { color: var(--ep-ink-3); cursor: not-allowed; opacity: 0.6; }
.sc-ep-save {
  appearance: none;
  border: 0;
  background: var(--ep-accent);
  color: #fff;
  border-radius: 8px;
  padding: 8px 16px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
  transition: background-color 150ms ease, transform 140ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-save:hover:not(:disabled) { background: var(--ep-accent-2); }
}
.sc-ep-save:active:not(:disabled) { transform: scale(0.97); }
.sc-ep-save:disabled { background: var(--ep-field-2); color: var(--ep-ink-3); cursor: not-allowed; }

.sc-edit-panel :focus-visible {
  outline: 2px solid var(--ep-accent);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .sc-edit-panel { animation: none; }
}

/* In-page element inspector (requirement D) ---------------------------- */
/* A non-interactive overlay at an element's viewport rect: a magenta tag badge,
   class + dimensions, and violet spacing pills. Shown on hover (Browse + Edit)
   and while an element is selected. Matches the reference's on-canvas inspector. */
.sc-inspect-container { position: absolute; inset: 0; pointer-events: none; }
.sc-inspect-box {
  position: fixed;
  pointer-events: none;
  box-shadow: 0 0 0 1.5px #e838c4, 0 0 0 3.5px rgba(232, 56, 196, 0.18);
  border-radius: 1px;
  z-index: 1;
}
.sc-inspect-tag {
  position: fixed;
  transform: translateY(-100%);
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  background: #e838c4;
  color: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px 4px 4px 0;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  z-index: 2;
}
.sc-inspect-dims {
  position: fixed;
  transform: translate(-50%, 6px);
  pointer-events: none;
  padding: 2px 7px;
  background: rgba(20, 18, 24, 0.92);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  border-radius: 999px;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  z-index: 2;
}
.sc-inspect-pill {
  position: fixed;
  transform: translate(-50%, -50%);
  pointer-events: none;
  min-width: 20px;
  padding: 1px 6px;
  background: #6d5ef0;
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: center;
  border-radius: 999px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
  z-index: 2;
}
`;
