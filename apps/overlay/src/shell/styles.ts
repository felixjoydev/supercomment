/**
 * Overlay styles, scoped to the shadow root.
 *
 * Because all overlay DOM lives inside a shadow root (see `shell/root.ts`),
 * the host app's stylesheet cannot reach these nodes and these rules cannot
 * leak out (design-lens D-01 isolation). We still reset aggressively and pin a
 * very high z-index inside our own stacking context so we float above the host.
 *
 * This is an original SuperComment design (clean-room) — calm slate surface,
 * a single indigo accent, soft elevation. No third-party UI is reproduced.
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
  position: fixed;
  inset: 0;
  z-index: ${OVERLAY_Z_INDEX};
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: #0f172a;
  pointer-events: none;
}
.sc-layer > * {
  pointer-events: auto;
}

/* Toolbar -------------------------------------------------------------- */
.sc-toolbar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.18);
  border: 1px solid rgba(15, 23, 42, 0.08);
}
.sc-mode-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: #475569;
  border-radius: 10px;
  padding: 8px 12px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 54px;
}
.sc-mode-btn:hover {
  background: #f1f5f9;
}
.sc-mode-btn[aria-pressed="true"] {
  background: #4f46e5;
  color: #ffffff;
}
.sc-mode-key {
  font-size: 10px;
  opacity: 0.7;
}
.sc-toolbar-sep {
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: rgba(15, 23, 42, 0.1);
}

/* Reviewer chip ------------------------------------------------------- */
.sc-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: #475569;
}
.sc-chip-name {
  font-weight: 600;
  color: #0f172a;
}
.sc-chip-change {
  appearance: none;
  border: 0;
  background: transparent;
  color: #4f46e5;
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
}

/* Multi confirm ------------------------------------------------------- */
.sc-multi-confirm {
  appearance: none;
  border: 0;
  background: #4f46e5;
  color: #fff;
  border-radius: 10px;
  padding: 8px 14px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.sc-multi-confirm:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}

/* Highlights / selection visuals -------------------------------------- */
.sc-highlight {
  position: fixed;
  border: 2px solid #4f46e5;
  border-radius: 6px;
  background: rgba(79, 70, 229, 0.08);
  pointer-events: none;
}
.sc-area {
  position: fixed;
  border: 2px dashed #4f46e5;
  background: rgba(79, 70, 229, 0.06);
  pointer-events: none;
}

/* Comment form -------------------------------------------------------- */
.sc-form {
  position: fixed;
  width: 320px;
  padding: 14px;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.22);
  border: 1px solid rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sc-form textarea {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 8px 10px;
  font: inherit;
  color: #0f172a;
}
.sc-field-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}
.sc-segmented {
  display: flex;
  gap: 4px;
}
.sc-seg {
  flex: 1;
  appearance: none;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #475569;
  border-radius: 8px;
  padding: 6px 4px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.sc-seg[aria-pressed="true"] {
  background: #4f46e5;
  border-color: #4f46e5;
  color: #fff;
}
.sc-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.sc-btn-secondary {
  appearance: none;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #475569;
  border-radius: 8px;
  padding: 7px 12px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.sc-btn-primary {
  appearance: none;
  border: 0;
  background: #4f46e5;
  color: #fff;
  border-radius: 8px;
  padding: 7px 14px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.sc-btn-primary:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}

/* Guest modal --------------------------------------------------------- */
.sc-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sc-modal {
  width: 300px;
  padding: 18px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.3);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sc-modal h2 {
  margin: 0;
  font-size: 15px;
  color: #0f172a;
}
.sc-modal input {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 9px 11px;
  font: inherit;
}

/* Markers ------------------------------------------------------------- */
.sc-marker {
  position: fixed;
  width: 26px;
  height: 26px;
  margin: -13px 0 0 -13px;
  border-radius: 50% 50% 50% 2px;
  background: #4f46e5;
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
  cursor: pointer;
}
.sc-marker.sc-cluster {
  background: #1e293b;
  border-radius: 13px;
}
.sc-edge {
  position: fixed;
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background: #1e293b;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.4);
}
`;
