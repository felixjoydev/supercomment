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

/* Visual editor — properties panel (U9) ------------------------------- */
/* A right-side inspector bound to one element. Same quiet-gallery language as
   the form/modal. Direct child of .sc-layer so it opts back into pointer events
   (also set explicitly below). Clean-room original — no third-party UI. */
.sc-edit-panel {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 288px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 16px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-float);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: sc-panel-in 320ms var(--ease-out) both;
}
@keyframes sc-panel-in {
  from { opacity: 0; transform: translateX(12px) scale(0.98); }
  to { opacity: 1; transform: translateX(0) scale(1); }
}
.sc-ep-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.sc-ep-headings {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sc-ep-title {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.sc-ep-target {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--accent-deep);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 210px;
}
.sc-ep-close {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  flex: none;
  transition: background-color 160ms ease, color 160ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-close:hover { background: var(--soft); color: var(--ink); }
}
.sc-ep-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sc-ep-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
}
.sc-ep-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sc-ep-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
}
.sc-ep-label {
  font-size: 12.5px;
  color: var(--ink-2);
  font-weight: 500;
}
.sc-ep-input,
.sc-ep-number,
.sc-ep-select {
  border: 0;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  border-radius: 9px;
  padding: 6px 9px;
  font: inherit;
  font-size: 12.5px;
  color: var(--ink);
  background: var(--surface);
  transition: box-shadow 160ms ease;
}
.sc-ep-number {
  width: 84px;
  text-align: right;
}
.sc-ep-select {
  min-width: 108px;
}
.sc-ep-input:focus,
.sc-ep-number:focus,
.sc-ep-select:focus {
  outline: none;
  box-shadow: inset 0 0 0 1.5px var(--accent), 0 0 0 3px var(--accent-ring);
}
.sc-ep-textarea {
  width: 100%;
  min-height: 54px;
  resize: vertical;
}
.sc-ep-color {
  width: 40px;
  height: 28px;
  padding: 2px;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  border-radius: 9px;
  background: var(--surface);
  cursor: pointer;
}
.sc-ep-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sc-ep-btn {
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  background: var(--surface);
  color: var(--ink);
  border-radius: 999px;
  padding: 6px 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 160ms ease, transform 140ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-btn:hover { background: rgba(35, 31, 24, 0.04); }
}
.sc-ep-btn:active {
  transform: scale(0.96);
}
.sc-ep-insert {
  flex-wrap: wrap;
}
.sc-ep-insert-text {
  flex: 1;
  min-width: 96px;
}
.sc-ep-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.sc-ep-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.sc-ep-discard {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  padding: 6px 10px;
  border-radius: 999px;
  transition: background-color 160ms ease, color 160ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-discard:hover { color: var(--accent-deep); background: var(--accent-soft); }
}
.sc-ep-discard-armed,
.sc-ep-discard-armed:hover {
  color: #fff;
  background: var(--accent);
}
.sc-ep-hint {
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.4;
}
@media (prefers-reduced-motion: reduce) {
  .sc-edit-panel { animation: none; }
}
`;
