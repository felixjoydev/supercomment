import type {
  BoundingBox,
  CapturedContext,
  ElementAnchor,
  Viewport,
} from "@supercomment/shared";

import { redactSecrets } from "@supercomment/shared";

import type { Rect, SelectionTarget } from "../core/types.js";
import { captureAnchors, buildDomPath, cssEscape } from "./anchors.js";
import { getRecentConsoleErrors } from "./console-buffer.js";

/**
 * Generic (Tier 1) context capture — works on any framework with zero install.
 *
 * Produces every generic field of {@link CapturedContext}:
 *  - a unique CSS `selector` (id / test-id / stable-attr preferred over hashed
 *    classes, falling back to an nth-child path),
 *  - a key subset of `computedStyles`,
 *  - `surroundingHtml` (the element plus a little parent context),
 *  - `boundingBox`,
 *  - page `url` + `viewport`,
 *  - recent `consoleErrors`,
 *  - the multi-anchor set (`anchors`).
 *
 * Returns everything *except* the optional `react` and `screenshot` fields,
 * which the composing capturer (index.ts) fills in. Operates over a
 * {@link SelectionTarget} so it handles element / multi / text / area modes.
 */
export type GenericContext = Omit<CapturedContext, "react" | "screenshot">;

/**
 * Computed-style properties worth carrying to a model. Layout, box, typography
 * and color — enough to reason about appearance without dumping the full
 * CSSStyleDeclaration (hundreds of props).
 */
const KEY_STYLE_PROPERTIES = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "z-index",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap",
];

/** Max characters of surrounding HTML retained (keeps payloads model-sized). */
const MAX_SURROUNDING_HTML_LENGTH = 4000;

/**
 * Attributes considered stable enough to build a selector from, in priority
 * order. Hashed/utility class names are deliberately excluded.
 */
const STABLE_ATTRIBUTES = [
  "data-testid",
  "data-test-id",
  "data-test",
  "data-qa",
  "data-cy",
  "name",
  "aria-label",
];

/**
 * The "primary" element of a selection — the one we build the selector,
 * computed styles, surrounding HTML and anchors from. `area` selections have no
 * element, so this returns null and we degrade to a region-only context.
 */
function primaryElement(target: SelectionTarget): Element | null {
  switch (target.kind) {
    case "element":
      return target.element;
    case "multi":
      return target.elements[0] ?? null;
    case "text":
    case "area":
      return null;
  }
}

/** Resolve a document from a target element, falling back to the global. */
function documentFor(el: Element | null): Document | undefined {
  return (
    el?.ownerDocument ??
    (typeof document !== "undefined" ? document : undefined)
  );
}

/**
 * Capture the generic-tier context for {@link target}.
 */
export function captureGenericContext(target: SelectionTarget): GenericContext {
  const el = primaryElement(target);
  const doc = documentFor(el);
  const view = doc?.defaultView ?? (typeof window !== "undefined" ? window : undefined);

  const context: GenericContext = {
    selector: selectorFor(target, el, doc),
    anchors: anchorsFor(target, el),
    url: readUrl(view),
    consoleErrors: getRecentConsoleErrors(),
  };

  const viewport = readViewport(view);
  if (viewport) {
    context.viewport = viewport;
  }

  const boundingBox = boundingBoxFor(target, el);
  if (boundingBox) {
    context.boundingBox = boundingBox;
  }

  if (el && view) {
    const styles = readComputedStyles(el, view);
    if (Object.keys(styles).length > 0) {
      context.computedStyles = styles;
    }
  }

  const html = surroundingHtmlFor(target, el);
  if (html) {
    context.surroundingHtml = html;
  }

  return context;
}

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

function selectorFor(
  target: SelectionTarget,
  el: Element | null,
  doc: Document | undefined,
): string {
  if (target.kind === "area") {
    // No element to anchor to; the region rect is the anchor.
    return ":root";
  }
  if (target.kind === "multi") {
    const selectors = target.elements
      .map((e) => (doc ? buildUniqueSelector(e, doc) : tagName(e)))
      .filter(Boolean);
    return selectors.length > 0 ? selectors.join(", ") : ":root";
  }
  if (el && doc) {
    return buildUniqueSelector(el, doc);
  }
  if (el) {
    // No document (shouldn't happen in practice) — best-effort dom path.
    return buildDomPath(el) ?? tagName(el);
  }
  // text selection without a resolvable element
  return ":root";
}

/**
 * Build a unique CSS selector for {@link target}.
 *
 * Strategy (hand-rolled, finder-style):
 *  1. If the element has a document-unique id, use `#id`.
 *  2. Otherwise walk up the tree building a path of segments. Each segment
 *     prefers, in order: a unique stable attribute, then a unique-among-siblings
 *     id, then tag + :nth-of-type. After each step we test whether the
 *     accumulated selector is already unique and stop early if so.
 *  3. Hashed/utility classes are never used — they are the primary source of
 *     selector drift.
 */
export function buildUniqueSelector(target: Element, doc: Document): string {
  const id = target.getAttribute?.("id");
  if (id && isUnique(doc, `#${cssEscape(id)}`)) {
    return `#${cssEscape(id)}`;
  }

  const segments: string[] = [];
  let node: Element | null = target;

  while (node && node.nodeType === 1 && node.tagName?.toLowerCase() !== "html") {
    const segment = segmentFor(node, doc);
    segments.unshift(segment.value);

    const candidate = segments.join(" > ");
    if (segment.locallyUnique && isUnique(doc, candidate)) {
      return candidate;
    }

    node = node.parentElement;
  }

  return segments.length > 0 ? segments.join(" > ") : tagName(target);
}

interface Segment {
  value: string;
  /** True if this segment alone is likely unique among siblings. */
  locallyUnique: boolean;
}

function segmentFor(node: Element, doc: Document): Segment {
  const tag = tagName(node);

  for (const attr of STABLE_ATTRIBUTES) {
    const value = node.getAttribute?.(attr);
    if (!value) {
      continue;
    }
    const sel = `${tag}[${attr}="${cssAttrEscape(value)}"]`;
    if (isUnique(doc, sel)) {
      return { value: sel, locallyUnique: true };
    }
  }

  const id = node.getAttribute?.("id");
  if (id) {
    return { value: `${tag}#${cssEscape(id)}`, locallyUnique: true };
  }

  const parent = node.parentElement;
  if (!parent) {
    return { value: tag, locallyUnique: true };
  }
  const sameTag = Array.from(parent.children).filter(
    (c) => c.tagName === node.tagName,
  );
  if (sameTag.length === 1) {
    return { value: tag, locallyUnique: false };
  }
  const index = sameTag.indexOf(node) + 1;
  return { value: `${tag}:nth-of-type(${index})`, locallyUnique: false };
}

function tagName(node: Element): string {
  return node.tagName?.toLowerCase() ?? "*";
}

/** Whether {@link selector} matches exactly one element in {@link doc}. */
function isUnique(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

/** Escape a value for use inside a `[attr="..."]` selector. */
function cssAttrEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

function anchorsFor(
  target: SelectionTarget,
  el: Element | null,
): ElementAnchor[] {
  if (el) {
    return captureAnchors(el);
  }
  if (target.kind === "text") {
    return [{ type: "text", value: target.quotedText }];
  }
  if (target.kind === "area") {
    return [{ type: "region", value: JSON.stringify(target.rect) }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Bounding box + viewport + url
// ---------------------------------------------------------------------------

function boundingBoxFor(
  target: SelectionTarget,
  el: Element | null,
): BoundingBox | undefined {
  if (el) {
    const rect = safeBoundingRect(el);
    if (rect) {
      return {
        x: rect.x ?? rect.left ?? 0,
        y: rect.y ?? rect.top ?? 0,
        width: Math.max(0, rect.width ?? 0),
        height: Math.max(0, rect.height ?? 0),
      };
    }
  }
  // Fall back to the selection rect the overlay already computed.
  return rectToBoundingBox(target.rect);
}

function rectToBoundingBox(rect: Rect | undefined): BoundingBox | undefined {
  if (!rect) {
    return undefined;
  }
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(0, rect.width),
    height: Math.max(0, rect.height),
  };
}

interface RectLike {
  x?: number;
  y?: number;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}

function safeBoundingRect(el: Element): RectLike | null {
  try {
    return el.getBoundingClientRect?.() ?? null;
  } catch {
    return null;
  }
}

function readUrl(view: Window | undefined): string {
  try {
    const href = view?.location?.href;
    if (href) {
      return href;
    }
  } catch {
    /* ignore */
  }
  return "about:blank";
}

/**
 * Viewport size + DPR. The shared schema requires positive-integer
 * width/height, so we return `undefined` (omit the field) when we can't read a
 * positive size rather than emitting an invalid 0.
 */
function readViewport(view: Window | undefined): Viewport | undefined {
  if (!view) {
    return undefined;
  }
  const width = Math.trunc(
    view.innerWidth || view.document?.documentElement?.clientWidth || 0,
  );
  const height = Math.trunc(
    view.innerHeight || view.document?.documentElement?.clientHeight || 0,
  );
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  const viewport: Viewport = { width, height };
  if (typeof view.devicePixelRatio === "number" && view.devicePixelRatio > 0) {
    viewport.devicePixelRatio = view.devicePixelRatio;
  }
  return viewport;
}

// ---------------------------------------------------------------------------
// Computed styles + surrounding HTML
// ---------------------------------------------------------------------------

function readComputedStyles(
  el: Element,
  view: Window,
): Record<string, string> {
  const styles: Record<string, string> = {};
  const getComputed = view.getComputedStyle?.bind(view);
  if (!getComputed) {
    return styles;
  }
  let declaration: CSSStyleDeclaration;
  try {
    declaration = getComputed(el);
  } catch {
    return styles;
  }
  for (const prop of KEY_STYLE_PROPERTIES) {
    const value = declaration.getPropertyValue?.(prop);
    if (value) {
      styles[camelize(prop)] = value.trim();
    }
  }
  return styles;
}

/** `background-color` -> `backgroundColor`. */
function camelize(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function surroundingHtmlFor(
  target: SelectionTarget,
  el: Element | null,
): string | undefined {
  // U13: every captured-text path is redacted through the canonical shared
  // module before it can leave the page — surrounding HTML can contain tokens,
  // keys, or PII in attributes/text nodes.
  if (el) {
    const html = readSurroundingHtml(el);
    return html === undefined ? undefined : redactSecrets(html);
  }
  if (target.kind === "text") {
    return redactSecrets(target.quotedText.slice(0, MAX_SURROUNDING_HTML_LENGTH));
  }
  return undefined;
}

/**
 * The element's `outerHTML`, prefixed with a one-line opening tag of its parent
 * for a little structural context, then length-capped. Best-effort.
 */
function readSurroundingHtml(el: Element): string | undefined {
  let html = "";
  try {
    const parent = el.parentElement;
    if (parent) {
      html += openingTag(parent) + "\n  ";
    }
    html += el.outerHTML ?? "";
    if (parent) {
      html += "\n</" + parent.tagName.toLowerCase() + ">";
    }
  } catch {
    html = "";
  }
  if (!html) {
    return undefined;
  }
  if (html.length > MAX_SURROUNDING_HTML_LENGTH) {
    return html.slice(0, MAX_SURROUNDING_HTML_LENGTH) + "…";
  }
  return html;
}

/** Render just the opening tag (no children) of an element. */
function openingTag(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attrs = el.attributes
    ? Array.from(el.attributes)
        .map((a) => `${a.name}="${a.value}"`)
        .join(" ")
    : "";
  return attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
}
