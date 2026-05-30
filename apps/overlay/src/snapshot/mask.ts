/**
 * Secret + form-value masking for snapshots (U10).
 *
 * Snapshots can capture whatever the reviewer's page is showing — including
 * a half-filled login form or an API token rendered into the DOM. We strip the
 * obvious cases before the payload ever leaves the browser.
 *
 * U13 consolidation: the secret-shaped patterns now come from the canonical
 * `@supercomment/shared` redaction module (the single source reused by context
 * capture and any server-side pass). This file keeps the snapshot-specific DOM
 * walking + form-control masking on top of those shared patterns.
 *
 * Best-effort by design: regex/DOM heuristics never catch everything.
 */
import { REDACTION_PATTERNS } from "@supercomment/shared";

/** Replace secret-shaped substrings in free text. */
export function maskText(text: string): string {
  let out = text;
  for (const re of REDACTION_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, "[redacted]");
    re.lastIndex = 0;
  }
  return out;
}

const SENSITIVE_INPUT_TYPES = new Set([
  "password",
  "email",
  "tel",
  "hidden",
  "number",
]);

const SENSITIVE_ATTRS = ["value", "data-value"];

/**
 * Mask a single serialized node in place: form-control values and any
 * secret-shaped text in attributes or text content.
 */
export function maskNode(node: {
  tag?: string;
  attrs?: Record<string, string>;
  text?: string;
  type?: string;
}): void {
  // Mask sensitive form-control values.
  if (node.tag && node.attrs) {
    const type = (node.attrs["type"] ?? "").toLowerCase();
    const isFormControl =
      node.tag === "input" || node.tag === "textarea" || node.tag === "select";
    if (isFormControl) {
      const shouldMaskAll =
        node.tag !== "input" || SENSITIVE_INPUT_TYPES.has(type) || type === "";
      for (const attr of SENSITIVE_ATTRS) {
        if (node.attrs[attr] !== undefined) {
          node.attrs[attr] = shouldMaskAll
            ? "[masked]"
            : maskText(node.attrs[attr]);
        }
      }
    } else {
      for (const attr of Object.keys(node.attrs)) {
        node.attrs[attr] = maskText(node.attrs[attr]);
      }
    }
  }

  if (node.text) {
    node.text = maskText(node.text);
  }
}

/** Recursively mask a serialized DOM tree in place. */
export function maskTree(node: {
  tag?: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: unknown[];
}): void {
  maskNode(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      maskTree(child as Parameters<typeof maskTree>[0]);
    }
  }
}
