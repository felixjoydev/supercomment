import type { A11yNode } from "@supercomment/shared";
import { redactSecrets } from "@supercomment/shared";

import { effectiveRole, normalizeAnchorText } from "./anchors.js";

/**
 * Accessibility / ancestor-chain capture.
 *
 * Records the target element and up to {@link MAX_DEPTH} ancestors as a flat
 * chain (target first), each with `role`, accessible `name`, `tagName`, `id`,
 * and `className`. This gives a coding agent structural context for locating the
 * right component (ancestor ids/classNames are strong grep signals) and surfaces
 * accessibility issues. Pure and read-only — no DOM mutation, no globals.
 *
 * Best-effort: any node that can't be described is skipped; the accessible name
 * is run through the canonical redactor in case it carries a secret/PII.
 */

const MAX_DEPTH = 5;
const MAX_NAME_LENGTH = 80;
const MAX_ATTR_LENGTH = 120;

/** Capture the a11y/ancestor chain for `el`, or null when unavailable. */
export function captureA11yTree(el: Element | null): A11yNode[] | null {
  if (!el) {
    return null;
  }
  const nodes: A11yNode[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < MAX_DEPTH) {
    const node = describeNode(current);
    if (node) {
      nodes.push(node);
    }
    current = current.parentElement;
    depth += 1;
  }
  return nodes.length > 0 ? nodes : null;
}

/** Describe a single element as an {@link A11yNode}. */
export function describeNode(el: Element): A11yNode | null {
  const tagName = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
  if (!tagName) {
    return null;
  }
  const node: A11yNode = { tagName };

  const role = safeRole(el);
  if (role) {
    node.role = role;
  }
  const name = accessibleName(el);
  if (name) {
    node.name = name;
  }
  const id = el.getAttribute?.("id")?.trim();
  if (id) {
    node.id = id.slice(0, MAX_ATTR_LENGTH);
  }
  const className = el.getAttribute?.("class")?.trim();
  if (className) {
    node.className = className.slice(0, MAX_ATTR_LENGTH);
  }
  return node;
}

function safeRole(el: Element): string | undefined {
  try {
    return effectiveRole(el);
  } catch {
    return undefined;
  }
}

/**
 * Best-effort accessible name: explicit ARIA / alt / title / placeholder, then
 * the element's normalized visible text. Always redacted + capped.
 */
function accessibleName(el: Element): string | undefined {
  const labelled = [
    el.getAttribute?.("aria-label"),
    el.getAttribute?.("alt"),
    el.getAttribute?.("title"),
    el.getAttribute?.("placeholder"),
  ];
  for (const candidate of labelled) {
    const value = candidate?.trim();
    if (value) {
      return redactSecrets(value.slice(0, MAX_NAME_LENGTH));
    }
  }
  const text = normalizeAnchorText(
    (el as { textContent?: string }).textContent ?? "",
  );
  return text ? redactSecrets(text) : undefined;
}
