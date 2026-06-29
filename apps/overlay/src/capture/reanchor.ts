/**
 * Re-anchor resolver (U8) — the READ-BACK counterpart of `anchors.ts`.
 *
 * When the customer redeploys, the live DOM changes. To re-show an existing
 * comment we must re-locate its element from the multi-anchor set captured at
 * comment time (`context.anchors`) against the CURRENT document.
 *
 * The correctness rule (from review): `role`, `text`, and `dom-path` are
 * NON-UNIQUE — many elements share a role, a label, or fall on a structurally
 * similar path. Resolving to the FIRST match would silently mis-anchor a comment
 * to the WRONG element, which is worse than an honest "stale" mark. So:
 *
 *   - A UNIQUE match on a high-durability anchor (`id`, then `data-testid`) is
 *     trusted on its own → resolved.
 *   - Anything else (a high-durability anchor that matched >1 element, or only
 *     `role`/`text`/`dom-path` matches) MUST be CORROBORATED: a single element
 *     that ≥2 distinct anchors agree on → resolved. If no single element is
 *     agreed on by ≥2 anchors (none match, only one anchor matches, or two
 *     elements tie), the comment is STALE — we never guess.
 *
 * Pure + dependency-injected: it operates on the passed `Document` only (no
 * ambient globals), so it is unit-tested against the repo's DOM double as well
 * as a real browser / jsdom. It returns the resolved `Element` (or `null`); the
 * caller (controller) reads the live rect and renders the marker or its stale
 * variant. Stale is computed client-side only here (server persistence of the
 * stale flag is deferred per plan).
 */
import type { ElementAnchor } from "@supercomment/shared";

import {
  TEST_ID_ATTRIBUTES,
  cssEscape,
  effectiveRole,
  normalizeAnchorText,
} from "./anchors.js";

export interface ResolveResult {
  /** The confidently re-anchored element, or `null` when stale. */
  element: Element | null;
  /** True when the element is gone or could not be confidently resolved. */
  isStale: boolean;
}

/**
 * Anchor kinds durable enough that a UNIQUE match is trusted without
 * corroboration, in descending durability order.
 */
const HIGH_DURABILITY_TYPES = ["id", "data-testid"] as const;

/**
 * Re-resolve an element from its captured anchors against the live `doc`.
 *
 * @returns the resolved element + `isStale:false`, or `{ element:null,
 * isStale:true }` when the element is gone or only ambiguously matched.
 */
export function resolveAnchors(
  anchors: ElementAnchor[],
  doc: Document,
): ResolveResult {
  if (!anchors || anchors.length === 0) {
    return stale();
  }

  // Live matches per anchor; anchors that resolve to nothing are dropped.
  const matched: { type: string; elements: Element[] }[] = [];
  for (const anchor of anchors) {
    const elements = matchesForAnchor(anchor, doc);
    if (elements.length > 0) {
      matched.push({ type: anchor.type, elements });
    }
  }
  if (matched.length === 0) {
    return stale();
  }

  // 1) A UNIQUE high-durability anchor (id, then data-testid) is trusted alone.
  for (const type of HIGH_DURABILITY_TYPES) {
    const hit = matched.find((m) => m.type === type);
    if (hit && hit.elements.length === 1) {
      return { element: hit.elements[0]!, isStale: false };
    }
  }

  // 2) Otherwise require corroboration: count how many DISTINCT anchors point
  //    at each element, then accept only a single element agreed on by >= 2.
  const counts = new Map<Element, number>();
  for (const { elements } of matched) {
    const seen = new Set<Element>();
    for (const el of elements) {
      if (seen.has(el)) continue; // count each anchor at most once per element
      seen.add(el);
      counts.set(el, (counts.get(el) ?? 0) + 1);
    }
  }

  let best: Element | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [el, count] of counts) {
    if (count > bestCount) {
      best = el;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }

  // Need a SINGLE element corroborated by >= 2 anchors. A tie at the top, or a
  // top count below 2 (only one non-unique anchor matched), is not confident.
  if (best && bestCount >= 2 && !tied) {
    return { element: best, isStale: false };
  }

  // Non-unique / uncorroborated → honest stale; never guess the first match.
  return stale();
}

function stale(): ResolveResult {
  return { element: null, isStale: true };
}

/** Live elements an anchor matches, deduped. Never throws. */
function matchesForAnchor(anchor: ElementAnchor, doc: Document): Element[] {
  const value = anchor.value;
  if (!value) return [];

  switch (anchor.type) {
    case "id":
      // An id selector is the most durable lookup; CSS-escape the value.
      return safeQueryAll(doc, `#${cssEscape(value)}`);
    case "data-testid":
      return matchTestId(doc, value);
    case "role":
      return matchRole(doc, value);
    case "text":
      return matchText(doc, value);
    case "dom-path":
      // The stored value is already a queryable CSS path (see buildDomPath).
      return safeQueryAll(doc, value);
    default:
      return [];
  }
}

/**
 * A `data-testid` anchor stores its value under the canonical type even when it
 * was sourced from a variant (`data-cy`, `data-qa`, …), so re-resolve across the
 * SAME attribute set and union the hits.
 */
function matchTestId(doc: Document, value: string): Element[] {
  const out = new Set<Element>();
  const escaped = escapeAttrValue(value);
  for (const attr of TEST_ID_ATTRIBUTES) {
    for (const el of safeQueryAll(doc, `*[${attr}="${escaped}"]`)) {
      out.add(el);
    }
  }
  return [...out];
}

/**
 * Match by effective role. We enumerate elements and compare their effective
 * role (explicit `role=` else implicit) rather than only querying `[role=...]`,
 * so an element whose role is implicit (e.g. a bare `<button>`) is found too —
 * mirroring how capture derived the anchor.
 */
function matchRole(doc: Document, value: string): Element[] {
  return safeQueryAll(doc, "*").filter((el) => effectiveRole(el) === value);
}

/**
 * Match by normalised text. There is no CSS selector for text content, so
 * enumerate and compare under the SAME normalisation capture used.
 */
function matchText(doc: Document, value: string): Element[] {
  return safeQueryAll(doc, "*").filter(
    (el) => normalizeAnchorText(el.textContent ?? "") === value,
  );
}

/** Escape a value for safe embedding inside an `[attr="…"]` selector. */
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * `querySelectorAll` that never throws (a drifted/invalid stored selector must
 * degrade to "no match" → eventually stale, not a crash) and returns a plain
 * array for ergonomic use.
 */
function safeQueryAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}
