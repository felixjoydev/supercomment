/** Overlay styles — editor section. Concatenated (in order) into OVERLAY_STYLES; do not edit the emitted string's bytes without re-verifying byte-identity. */
export const EDITOR_STYLES = `/* Visual editor — properties panel (editor redesign) ------------------- */
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

/* U18: per-corner radius inputs collapse until expanded. */
.sc-ep-corners[data-open="0"] { display: none; }
.sc-ep-corners[data-open="1"] {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 6px;
}
.sc-ep-corners-toggle {
  appearance: none;
  border: 0;
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  color: var(--ep-ink-2);
  border-radius: 7px;
  padding: 5px 10px;
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
.sc-ep-corners-toggle[aria-pressed="true"] { color: var(--ep-ink); background: var(--ep-field); }

/* U6: replace-image file input + URL row. */
.sc-ep-file {
  font: inherit;
  font-size: 12px;
  color: var(--ep-ink-2);
  max-width: 60%;
}
.sc-ep-image-url .sc-ep-hex { flex: 1; min-width: 0; }
.sc-ep-image-apply { flex: 0 0 auto; }

/* U2: a control whose live preview could not be verified on the reviewer's page.
   The value is still recorded for the agent; this is an honesty signal, not an
   error. Reused by U8's font-picker degradation badge. */
.sc-ep-degraded {
  font-size: 11px;
  line-height: 1;
  color: var(--ep-warn, #e0a33a);
  cursor: help;
  flex: 0 0 auto;
}
.sc-ep-row[data-sc-degraded="1"] .sc-ep-label {
  color: var(--ep-warn, #e0a33a);
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
  appearance: none;
  border: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--ep-ink-2);
  cursor: pointer;
  padding: 4px 2px;
  border-radius: 6px;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-count:hover { color: var(--ep-ink); }
}
.sc-ep-undo,
.sc-ep-redo {
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
  .sc-ep-undo:hover:not(:disabled),
  .sc-ep-redo:hover:not(:disabled) { background: var(--ep-field); }
}
.sc-ep-undo:disabled,
.sc-ep-redo:disabled { color: var(--ep-ink-3); cursor: not-allowed; opacity: 0.6; }
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

/* U3: the session review list (R17), anchored above the footer counter. */
.sc-ep-edits {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 64px;
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  background: var(--ep-field);
  border: 1px solid var(--ep-line-2);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  z-index: 2;
}
.sc-ep-edit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 7px;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-edit-row:hover { background: var(--ep-field-2); }
}
.sc-ep-edit-label {
  font-size: 12px;
  color: var(--ep-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-ep-edit-revert {
  appearance: none;
  border: 0;
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  color: var(--ep-ink-2);
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
  flex: 0 0 auto;
}
.sc-ep-edits-empty {
  font-size: 12px;
  color: var(--ep-ink-3);
  padding: 6px 8px;
}
.sc-ep-edits-discard {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ep-danger, #e5484d);
  border-radius: 7px;
  padding: 8px;
  margin-top: 4px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}

/* U8: the font-family control is a picker-opening button, not a dropdown. */
.sc-ep-fontbtn {
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  border-radius: 8px;
  min-width: 132px;
  padding: 7px 26px 7px 9px;
  font: inherit;
  font-size: 12.5px;
  color: var(--ep-ink);
  background: var(--ep-field);
  background-image: linear-gradient(45deg, transparent 50%, var(--ep-ink-3) 50%),
    linear-gradient(135deg, var(--ep-ink-3) 50%, transparent 50%);
  background-position: calc(100% - 15px) 12px, calc(100% - 10px) 12px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: box-shadow 160ms ease, background-color 160ms ease;
}

/* U8: the picker popover — a searchable, grouped, keyboard-navigable list. */
.sc-ep-fontpop {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 96px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 340px;
  padding: 10px;
  background: var(--ep-field);
  border: 1px solid var(--ep-line-2);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  z-index: 3;
}
.sc-ep-fontsearch {
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 12.5px;
  color: var(--ep-ink);
  background: var(--ep-field-2);
}
.sc-ep-fontsearch:focus { outline: none; box-shadow: inset 0 0 0 1.5px var(--ep-accent); }
.sc-ep-fontlist {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
  min-height: 0;
}
.sc-ep-fontgroup {
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ep-ink-3);
  padding: 8px 8px 4px;
}
.sc-ep-fontempty {
  font-size: 12px;
  color: var(--ep-ink-3);
  padding: 4px 8px 8px;
}
.sc-ep-fontrow {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ep-ink);
  border-radius: 7px;
  padding: 7px 8px;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sc-ep-fontrow.is-active,
.sc-ep-fontrow[aria-selected="true"] { background: var(--ep-field-2); }
@media (hover: hover) and (pointer: fine) {
  .sc-ep-fontrow:hover { background: var(--ep-field-2); }
}
.sc-ep-fontbadge {
  font-size: 11px;
  line-height: 1;
  color: var(--ep-warn, #e0a33a);
  flex: 0 0 auto;
}
.sc-ep-fontweight {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}
.sc-ep-fontweight-sel {
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  border-radius: 8px;
  padding: 7px 26px 7px 9px;
  font: inherit;
  font-size: 12.5px;
  color: var(--ep-ink);
  background: var(--ep-field);
  min-width: 140px;
  cursor: pointer;
}
.sc-ep-fontweight-sel option { background: var(--ep-field); color: var(--ep-ink); }

/* U9: the Uploaded group's upload affordance (button + rights notice + errors). */
.sc-ep-fontupload-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 8px 8px;
}
.sc-ep-fontupload {
  appearance: none;
  border: 1px dashed var(--ep-line-2);
  background: transparent;
  color: var(--ep-ink);
  border-radius: 8px;
  padding: 9px 10px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  text-align: center;
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .sc-ep-fontupload:hover { background: var(--ep-field-2); }
}
.sc-ep-fontnotice {
  font-size: 11px;
  line-height: 1.4;
  color: var(--ep-ink-3);
}
.sc-ep-fonterror {
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--ep-danger, #e5484d);
}

/* U10: the color control is a picker-opening button (swatch + hex), not a
   native <input type=color> (which cannot express alpha). */
.sc-ep-colorbtn {
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  border-radius: 8px;
  min-width: 132px;
  padding: 6px 9px;
  font: inherit;
  font-size: 12.5px;
  color: var(--ep-ink);
  background: var(--ep-field);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sc-ep-colorbtn-sw {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  flex: 0 0 auto;
  /* a checkerboard shows through a translucent swatch */
  background-image: linear-gradient(45deg, #808080 25%, transparent 25%),
    linear-gradient(-45deg, #808080 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #808080 75%),
    linear-gradient(-45deg, transparent 75%, #808080 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
}
.sc-ep-colorbtn-txt {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

/* U10: the color picker popover. */
.sc-ep-colorpop {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 96px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--ep-field);
  border: 1px solid var(--ep-line-2);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  z-index: 3;
}
.sc-ep-sv {
  position: relative;
  height: 132px;
  border-radius: 8px;
  cursor: crosshair;
  /* saturation (x) over value (y); a real hue background is set inline at runtime */
  background:
    linear-gradient(to top, #000, transparent),
    linear-gradient(to right, #fff, transparent),
    #f00;
}
.sc-ep-sv-thumb {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.sc-ep-hue,
.sc-ep-alpha {
  width: 100%;
  height: 14px;
  margin: 0;
  cursor: pointer;
}
.sc-ep-hue {
  appearance: none;
  border-radius: 7px;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}
.sc-ep-colorhex-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.sc-ep-colorhex {
  flex: 1;
  min-width: 0;
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  border-radius: 8px;
  padding: 7px 9px;
  font: inherit;
  font-size: 12.5px;
  color: var(--ep-ink);
  background: var(--ep-field-2);
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
}
.sc-ep-eyedropper {
  appearance: none;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--ep-line-2);
  background: transparent;
  color: var(--ep-ink-2);
  border-radius: 8px;
  padding: 7px 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  flex: 0 0 auto;
}
.sc-ep-swatch-label {
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ep-ink-3);
}
.sc-ep-swatch-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sc-ep-swatch-btn {
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 5px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  cursor: pointer;
  padding: 0;
}

/* U14: the device-surface chip in the panel header (off the base "web" surface). */
.sc-ep-surface-chip {
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--ep-accent, #8b6dff);
  background: rgba(139, 109, 255, 0.16);
  border-radius: 5px;
  padding: 3px 7px;
  white-space: nowrap;
}

/* U11: a chip shown when a color pick matches a page design token. */
.sc-ep-token-chip {
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ep-accent);
  background: rgba(139, 109, 255, 0.14);
  border-radius: 6px;
  padding: 4px 8px;
}

.sc-edit-panel :focus-visible {
  outline: 2px solid var(--ep-accent);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .sc-edit-panel { animation: none; }
}

`;
