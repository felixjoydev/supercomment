/** Overlay styles — markers section. Concatenated (in order) into OVERLAY_STYLES; do not edit the emitted string's bytes without re-verifying byte-identity. */
export const MARKERS_STYLES = `/* Markers ------------------------------------------------------------- */
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

/* Thread: actions, replies, reply box (0033) -------------------------- */
.sc-comment-head {
  display: flex;
  align-items: center;
  gap: 2px;
}
.sc-comment-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sc-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ink-3);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.sc-act:hover {
  background: var(--soft);
  color: var(--ink);
}
.sc-act-done.is-on {
  background: var(--accent);
  color: #fff;
}
.sc-act-more-wrap {
  position: relative;
}
.sc-act-menu {
  position: absolute;
  top: 28px;
  right: 0;
  z-index: 2;
  min-width: 150px;
  padding: 5px;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}
.sc-act-menu[hidden] {
  display: none;
}
.sc-act-menu-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.sc-act-menu-item.is-danger {
  color: #c0392b;
}
.sc-act-menu-item.is-danger:hover {
  background: rgba(192, 57, 43, 0.1);
}
.sc-comment-entry.is-resolved .sc-comment-note {
  color: var(--ink-3);
  text-decoration: line-through;
  text-decoration-color: var(--ink-3);
}

.sc-reply-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.sc-reply {
  padding: 7px 10px;
  border-radius: 9px;
  background: var(--soft);
}
.sc-reply-head {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11.5px;
}
.sc-reply-author {
  font-weight: 600;
  color: var(--ink-2);
}
.sc-reply-time {
  color: var(--ink-3);
}
.sc-reply-del {
  margin-left: auto;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.sc-reply-del:hover {
  background: rgba(192, 57, 43, 0.12);
  color: #c0392b;
}
.sc-reply-body {
  margin-top: 3px;
  font-size: 13px;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.sc-reply-box {
  display: flex;
  gap: 6px;
  align-items: flex-end;
  margin-top: 10px;
}
.sc-reply-input {
  flex: 1;
  min-width: 0;
  resize: none;
  max-height: 96px;
  padding: 8px 10px;
  border-radius: 9px;
  border: none;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
}
.sc-reply-input:focus {
  outline: none;
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.sc-reply-send {
  flex-shrink: 0;
  padding: 8px 12px;
  border: none;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.sc-reply-send:hover {
  background: var(--accent-deep);
}
.sc-reply-send:disabled {
  opacity: 0.55;
  cursor: default;
}
.sc-comment-flash {
  margin-top: 8px;
  padding: 6px 9px;
  border-radius: 7px;
  font-size: 12px;
  color: #c0392b;
  background: rgba(192, 57, 43, 0.1);
}

/* A resolved (marked-done) pin dims. */
.sc-marker.sc-resolved {
  opacity: 0.55;
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
