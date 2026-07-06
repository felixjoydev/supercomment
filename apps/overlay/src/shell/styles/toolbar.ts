/** Overlay styles — toolbar section. Concatenated (in order) into OVERLAY_STYLES; do not edit the emitted string's bytes without re-verifying byte-identity. */
export const TOOLBAR_STYLES = `/* Toolbar -------------------------------------------------------------- */
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

/* Live realtime status dot (embedded review only) --------------------- */
/* Hidden until the controller reports a connection state, so tunnel / stub
   mounts (no realtime) never show it. Mirrors the dashboard's Live indicator. */
.sc-live {
  display: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: none;
  position: relative;
}
.sc-live.is-live,
.sc-live.is-connecting,
.sc-live.is-error {
  display: inline-block;
}
.sc-live.is-live {
  background: #2f9e6f;
}
.sc-live.is-connecting {
  background: #d9a441;
}
.sc-live.is-error {
  background: #d0552f;
}
.sc-live.is-live::before {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: 999px;
  background: #2f9e6f;
  opacity: 0.35;
  animation: sc-live-pulse 2s var(--ease-out) infinite;
}
@media (prefers-reduced-motion: reduce) {
  .sc-live.is-live::before {
    animation: none;
  }
}
@keyframes sc-live-pulse {
  0% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  100% {
    transform: scale(1.7);
    opacity: 0;
  }
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

`;
