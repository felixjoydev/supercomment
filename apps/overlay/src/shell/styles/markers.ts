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
