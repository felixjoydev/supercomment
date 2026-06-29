import type { ElementAnchor } from "@supercomment/shared";

/**
 * Multi-anchor capture (U7).
 *
 * A single CSS selector is brittle: it breaks the moment the page restructures
 * or class hashes change. To let a comment survive selector drift we capture a
 * *set* of independent anchors as `{ type, value }` pairs (the shape the shared
 * `elementAnchorSchema` expects). Re-anchoring (later units) can try each one in
 * turn until it re-locates the element.
 *
 * Anchor kinds, in rough order of durability:
 *  - `id`         — stable when the author set it; absent otherwise.
 *  - `data-testid`— `data-testid` (and common variants) are meant to be stable.
 *  - `role`       — explicit `role=` or the element's implicit ARIA role.
 *  - `text`       — a trimmed, length-capped snapshot of visible text.
 *  - `dom-path`   — a structural nth-child path from the document root; survives
 *                   class churn even when nothing semantic is present.
 *
 * For a bare `<div>` with only hashed classes this still yields at least a
 * `dom-path` (and usually a `text` and/or `role`) so re-anchoring beyond the
 * brittle selector remains possible.
 */

/**
 * Max characters of text content stored as a `text` anchor.
 *
 * Exported so the re-anchor resolver (`reanchor.ts`) caps a live element's text
 * with the IDENTICAL bound before comparing it to a stored anchor.
 */
export const MAX_TEXT_ANCHOR_LENGTH = 80;

/**
 * Attributes commonly used as stable test hooks, in priority order. Exported so
 * the resolver re-finds a `data-testid` anchor across the same attribute set
 * (the anchor is stored as type `data-testid` even when sourced from `data-cy`).
 */
export const TEST_ID_ATTRIBUTES = [
  "data-testid",
  "data-test-id",
  "data-test",
  "data-qa",
  "data-cy",
];

/**
 * Implicit ARIA role lookup for the handful of elements where the role is
 * meaningful for re-anchoring. A small, well-known subset rather than a full
 * HTML-AAM implementation. Exported so the resolver computes an element's
 * effective role identically to capture (via {@link effectiveRole}).
 */
export const IMPLICIT_ROLES: Record<string, string> = {
  a: "link",
  button: "button",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  article: "article",
  section: "region",
  form: "form",
  img: "img",
  table: "table",
  ul: "list",
  ol: "list",
  li: "listitem",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
};

/**
 * Build the multi-anchor set for {@link target}. Never throws; missing or
 * unreadable properties simply produce a smaller anchor set.
 */
export function captureAnchors(target: Element): ElementAnchor[] {
  const anchors: ElementAnchor[] = [];

  const id = readAttr(target, "id");
  if (id) {
    anchors.push({ type: "id", value: id });
  }

  const testId = readTestId(target);
  if (testId) {
    anchors.push({ type: "data-testid", value: testId });
  }

  const role = effectiveRole(target);
  if (role) {
    anchors.push({ type: "role", value: role });
  }

  const text = readTextContent(target);
  if (text) {
    anchors.push({ type: "text", value: text });
  }

  const domPath = buildDomPath(target);
  if (domPath) {
    anchors.push({ type: "dom-path", value: domPath });
  }

  return anchors;
}

function readAttr(target: Element, name: string): string | undefined {
  const value = target.getAttribute?.(name);
  return value ? value : undefined;
}

function readTestId(target: Element): string | undefined {
  for (const attr of TEST_ID_ATTRIBUTES) {
    const value = target.getAttribute?.(attr);
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * An element's effective role for anchoring: explicit `role=` wins, otherwise a
 * small implicit-role table. Exported + reused by the re-anchor resolver so
 * capture and resolution agree on what "role" means for a given element.
 */
export function effectiveRole(target: Element): string | undefined {
  const explicit = target.getAttribute?.("role");
  if (explicit) {
    return explicit;
  }
  return IMPLICIT_ROLES[target.tagName?.toLowerCase()];
}

/**
 * Normalise raw text into the stored `text` anchor value: collapse whitespace,
 * trim, and cap to {@link MAX_TEXT_ANCHOR_LENGTH} (ellipsis when truncated).
 * Returns `undefined` for empty/whitespace-only input.
 *
 * Exported + reused by the re-anchor resolver so a live element's text is
 * normalised IDENTICALLY before being compared to a stored anchor — otherwise a
 * trailing-space or casing-of-collapse difference would spuriously miss.
 */
export function normalizeAnchorText(raw: string): string | undefined {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return undefined;
  }
  if (collapsed.length <= MAX_TEXT_ANCHOR_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_TEXT_ANCHOR_LENGTH).trimEnd()}…`;
}

/**
 * Trimmed, whitespace-collapsed, length-capped text content. Falls back to
 * `textContent` of the whole subtree, which is acceptable for re-anchoring
 * since we only keep a capped prefix.
 */
function readTextContent(target: Element): string | undefined {
  return normalizeAnchorText(target.textContent ?? "");
}

/**
 * Structural nth-child path from the document root, e.g.
 * `html > body > div:nth-child(2) > button:nth-child(1)`.
 *
 * Uses tag + nth-child (not nth-of-type) so the path is a valid, queryable CSS
 * selector independent of class names and ids. An id short-circuits the walk
 * for a shorter, more stable path.
 */
export function buildDomPath(target: Element): string | undefined {
  if (!target.tagName) {
    return undefined;
  }

  const segments: string[] = [];
  let node: Element | null = target;

  while (node && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase();

    if (node.id) {
      // An id is unique enough to root the path here.
      segments.unshift(`${tag}#${cssEscape(node.id)}`);
      break;
    }

    const parent: Element | null = node.parentElement;
    if (!parent) {
      segments.unshift(tag);
      break;
    }

    const index = indexAmongSiblings(parent, node);
    segments.unshift(`${tag}:nth-child(${index})`);
    node = parent;
  }

  return segments.length > 0 ? segments.join(" > ") : undefined;
}

/** 1-based position of {@link node} among ALL element siblings. */
function indexAmongSiblings(parent: Element, node: Element): number {
  const children = parent.children ? Array.from(parent.children) : [];
  let index = 0;
  for (const child of children) {
    index += 1;
    if (child === node) {
      return index;
    }
  }
  return index;
}

/**
 * Minimal CSS identifier escaping. Prefers the platform `CSS.escape` when
 * available (browsers) and falls back to a conservative regex escape.
 */
export function cssEscape(value: string): string {
  const globalCss = (
    globalThis as { CSS?: { escape?: (v: string) => string } }
  ).CSS;
  if (globalCss && typeof globalCss.escape === "function") {
    return globalCss.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
