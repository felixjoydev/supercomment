/**
 * U9 — EditTarget assembly.
 *
 * Every visual-edit op needs a durable pointer back to the element it changed so
 * the agent can re-locate it in the live DOM and in source. We reuse the exact
 * capture-layer machinery the annotation path already uses:
 *
 *  - {@link buildUniqueSelector} — a best-effort unique CSS selector (id / stable
 *    attribute preferred over hashed classes),
 *  - {@link captureAnchors}      — the robust multi-anchor set (id, test-id, role,
 *    text, dom-path) that survives selector drift and drives re-anchoring,
 *  - {@link captureSourceStamp}  — the build-time `data-sc-source` `file:line:col`
 *    (preview builds only), so a `setStyle` can point at the attribute, not just
 *    the tag (R13).
 *
 * `source` is only populated when the stamp carries a COMPLETE `file:line:col`
 * (the shared `editTargetSchema` requires all three). Absent a usable stamp the
 * target is marked `sourceUnknown` so the agent relies on the anchors + the
 * screenshot and never fabricates a file path. Never throws.
 */
import type { EditTarget } from "@supercomment/shared";

import { buildUniqueSelector } from "../capture/generic.js";
import { captureAnchors } from "../capture/anchors.js";
import { captureSourceStamp } from "../capture/source.js";

/** Assemble the anchored {@link EditTarget} for a live element. */
export function buildEditTarget(el: Element, doc: Document): EditTarget {
  const target: EditTarget = {
    selector: safeSelector(el, doc),
    anchors: safeAnchors(el),
  };

  const stamp = captureSourceStamp(el);
  if (
    stamp &&
    typeof stamp.line === "number" &&
    stamp.line > 0 &&
    typeof stamp.column === "number" &&
    stamp.column >= 0
  ) {
    target.source = { file: stamp.file, line: stamp.line, column: stamp.column };
  } else {
    // Non-React / production / unstamped host (or a stamp missing line:col):
    // don't invent a file path — re-resolve via anchors + screenshot instead.
    target.sourceUnknown = true;
  }

  return target;
}

/** A selector is required (schema `min(1)`); fall back to the tag name. */
function safeSelector(el: Element, doc: Document): string {
  try {
    const sel = buildUniqueSelector(el, doc);
    if (sel && sel.trim()) return sel;
  } catch {
    /* fall through */
  }
  return el.tagName?.toLowerCase() || "*";
}

/** The multi-anchor set; never throws, an empty set is valid. */
function safeAnchors(el: Element): EditTarget["anchors"] {
  try {
    return captureAnchors(el);
  } catch {
    return [];
  }
}
