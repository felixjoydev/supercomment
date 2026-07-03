/**
 * Overlay styles, scoped to the shadow root.
 *
 * Because all overlay DOM lives inside a shadow root (see `shell/root.ts`), the
 * host app's stylesheet cannot reach these nodes and these rules cannot leak out
 * (design-lens D-01 isolation). We reset aggressively and pin a very high
 * z-index inside our own stacking context so we float above the host.
 *
 * This is an original SuperComment design (clean-room) — the same "quiet
 * gallery" language as the dashboard: warm ink, white pill surfaces, layered
 * shadows instead of borders, one persimmon accent. System sans only.
 *
 * The stylesheet is assembled from per-component chunks under ./styles/. The
 * concatenation order below is the original source order, and the emitted string
 * is byte-identical to the pre-split single literal (verified by comparing the
 * evaluated OVERLAY_STYLES before/after the split).
 */
export { OVERLAY_Z_INDEX } from "./styles/z-index.js";

import { BASE_STYLES } from "./styles/base.js";
import { TOOLBAR_STYLES } from "./styles/toolbar.js";
import { FORM_STYLES } from "./styles/form.js";
import { MARKERS_STYLES } from "./styles/markers.js";
import { RESPONSIVE_STYLES } from "./styles/responsive.js";
import { EDITOR_STYLES } from "./styles/editor.js";
import { INSPECTOR_STYLES } from "./styles/inspector.js";

export const OVERLAY_STYLES =
  BASE_STYLES +
  TOOLBAR_STYLES +
  FORM_STYLES +
  MARKERS_STYLES +
  RESPONSIVE_STYLES +
  EDITOR_STYLES +
  INSPECTOR_STYLES;
