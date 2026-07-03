/** Overlay styles — responsive section. Concatenated (in order) into OVERLAY_STYLES; do not edit the emitted string's bytes without re-verifying byte-identity. */
export const RESPONSIVE_STYLES = `/* Responsive device mode ---------------------------------------------- */
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

`;
