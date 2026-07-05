/**
 * Per-page comment index popover styles (U12), scoped to the shadow root. Same
 * "quiet gallery" language as the toolbar: white pill surface, layered shadow, one
 * persimmon accent; an unread red dot distinct from the accent.
 */
export const PAGES_STYLES = `
.sc-pages-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 140ms var(--ease-out);
}
.sc-pages-btn:hover { background: var(--accent-soft); }

.sc-pages-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: transparent;
}

.sc-pages {
  position: fixed;
  left: 50%;
  bottom: 84px;
  transform: translateX(-50%);
  width: min(320px, calc(100vw - 32px));
  max-height: min(50vh, 420px);
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.98);
  border-radius: 16px;
  box-shadow: var(--shadow-float);
  padding: 8px;
  color: var(--ink);
}

.sc-pages-head {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(35, 31, 24, 0.55);
  padding: 6px 10px 8px;
}

.sc-pages-empty {
  padding: 10px;
  font-size: 13px;
  color: rgba(35, 31, 24, 0.6);
}

.sc-pages-list { display: flex; flex-direction: column; gap: 2px; }

.sc-pages-row {
  appearance: none;
  border: 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 140ms var(--ease-out);
}
button.sc-pages-row:hover { background: var(--accent-soft); }
.sc-pages-row.is-current { background: var(--soft-bg, rgba(35, 31, 24, 0.05)); }

.sc-pages-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
}

.sc-pages-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #e5484d;
  box-shadow: 0 0 0 3px rgba(229, 72, 77, 0.16);
}

.sc-pages-count {
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(35, 31, 24, 0.08);
  color: var(--ink);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.sc-lapse {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100vw - 32px);
  padding: 10px 12px 10px 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: var(--shadow-float);
  color: var(--ink);
  font-size: 13px;
}

.sc-lapse-msg {
  color: rgba(35, 31, 24, 0.7);
}

.sc-lapse-btn {
  appearance: none;
  border: 0;
  padding: 7px 15px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 140ms var(--ease-out);
}

.sc-lapse-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
`;
