/**
 * U10 — content & style edits.
 *
 * Turns a selected element + a property/text change into the semantic ChangeOp
 * (the U1 contract shape) that gets recorded into the {@link EditSession}, and
 * applies the EPHEMERAL preview to the live DOM. The DOM mutation is throwaway —
 * a framework re-render may revert it (G6) — so the durable intent is the
 * change-set, not the mutated DOM. We record the semantic property change (with
 * before→after + the nearest token when known), never "the style attribute
 * string" (external best-practice: ship intent, let the agent translate to the
 * repo's styling idiom).
 *
 * The pure op-builders are unit-tested here; the EditTarget (selector + anchors +
 * source) is assembled by the capture layer and passed in at wire time (U13).
 */
import type { ChangeOp, DeviceSurface, EditTarget } from "@supercomment/shared";

import type { ColorProbe, Rgba } from "./color/normalize.js";

let opCounter = 0;
/** A stable-ish op id: crypto.randomUUID in the browser, counter fallback. */
export function newOpId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* fall through */
  }
  return `op-${opCounter++}-${Math.random().toString(36).slice(2)}`;
}

export interface StyleEditInput {
  target: EditTarget;
  /** CSS property, e.g. "font-size", "color", "border-radius". */
  property: string;
  /** Current value (the developer's build) — captured for verify + modify. */
  before: string | null;
  /** Desired value. */
  after: string;
  /** Nearest design token for `after`, when detectable (theme-robust). */
  valueToken?: string;
  /** Breakpoint this edit applies at (default = current viewport). */
  responsive?: DeviceSurface;
  /** Pseudo-state this edit applies to. */
  state?: "default" | "hover" | "focus";
}

/** Build a `setStyle` op from a style edit. */
export function buildStyleOp(input: StyleEditInput): ChangeOp {
  return {
    opId: newOpId(),
    type: "setStyle",
    target: input.target,
    property: input.property,
    before: input.before,
    after: input.after,
    ...(input.valueToken ? { valueToken: input.valueToken } : {}),
    ...(input.responsive ? { responsive: input.responsive } : {}),
    ...(input.state ? { state: input.state } : {}),
  };
}

/** Build a `setText` op from an inline text edit (normalized before→after). */
export function buildTextOp(
  target: EditTarget,
  before: string,
  after: string,
): ChangeOp {
  return { opId: newOpId(), type: "setText", target, before, after };
}

/**
 * Read the current computed value of a CSS property (for `before`). Returns the
 * trimmed value, or `null` when unavailable. Never throws.
 */
export function readComputedValue(el: Element, property: string): string | null {
  try {
    const win = el.ownerDocument?.defaultView as
      | { getComputedStyle?: (e: Element) => { getPropertyValue?: (p: string) => string } }
      | undefined;
    const cs = win?.getComputedStyle?.(el);
    const v = cs?.getPropertyValue?.(property);
    return v != null && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Read a colour-valued computed property as alpha-correct sRGB bytes, resolving
 * modern syntaxes (oklch/lab/color()) through the shared canvas pipeline. Returns
 * null when unavailable/unparseable. Never throws. (U1 read-truth for colours.)
 */
export function readComputedColor(
  el: Element,
  property: string,
  probe: ColorProbe,
): Rgba | null {
  const raw = readComputedValue(el, property);
  if (raw == null) return null;
  try {
    return probe.toRgba(raw);
  } catch {
    return null;
  }
}

/** Normalized text content of an element (collapsed whitespace). Never throws. */
export function readText(el: Element): string {
  try {
    return (el.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** Apply an ephemeral inline-style preview to the live DOM. Never throws. */
export function applyStylePreview(
  el: Element,
  property: string,
  value: string,
): void {
  try {
    (el as HTMLElement).style?.setProperty?.(property, value);
  } catch {
    /* preview is best-effort; a failure must not break editing */
  }
}

/** Apply an ephemeral plaintext preview to the live DOM. Never throws. */
export function applyTextPreview(el: Element, text: string): void {
  try {
    el.textContent = text;
  } catch {
    /* best-effort */
  }
}
