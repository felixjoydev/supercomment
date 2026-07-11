/** Overlay styles — inspector section. Concatenated (in order) into OVERLAY_STYLES; do not edit the emitted string's bytes without re-verifying byte-identity. */
export const INSPECTOR_STYLES = `/* In-page element inspector (requirement D) ---------------------------- */
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
/* U4: distance pills between the selection and a hovered element (R11). */
.sc-inspect-measure {
  position: fixed;
  transform: translate(-50%, -50%);
  pointer-events: none;
  min-width: 18px;
  padding: 1px 6px;
  background: #e838c4;
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: center;
  border-radius: 999px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
  z-index: 3;
}
/* U4/U6: a collapsed ghost at a hidden element's vacated slot. */
.sc-inspect-ghost {
  position: fixed;
  pointer-events: none;
  border: 1.5px dashed rgba(232, 56, 196, 0.7);
  background: repeating-linear-gradient(
    45deg,
    rgba(232, 56, 196, 0.06),
    rgba(232, 56, 196, 0.06) 6px,
    transparent 6px,
    transparent 12px
  );
  border-radius: 2px;
  z-index: 1;
}
`;
