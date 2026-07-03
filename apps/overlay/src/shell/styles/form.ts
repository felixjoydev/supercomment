/** Overlay styles — form section. Concatenated (in order) into OVERLAY_STYLES; do not edit the emitted string's bytes without re-verifying byte-identity. */
export const FORM_STYLES = `/* Highlights / selection visuals -------------------------------------- */
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

`;
