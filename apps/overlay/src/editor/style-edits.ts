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
import { getPropertyMeta, type PropCtx } from "./property-meta.js";

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
  /** The live preview could not be verified on the reviewer's page (U2). */
  previewUnavailable?: boolean;
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
    ...(input.previewUnavailable ? { previewUnavailable: true } : {}),
  };
}

/**
 * A layout edit (align/justify/gap/direction) implies a flex container — but ONLY
 * when the element is not already flex OR grid. Converting a grid to flex would
 * break the grid (R2), so a grid returns false; an unknown display defaults to
 * needing flex (the historical behavior).
 */
export function layoutEditImpliesFlex(displayComputed: string | null): boolean {
  return !(
    displayComputed === "flex" ||
    displayComputed === "inline-flex" ||
    displayComputed === "grid" ||
    displayComputed === "inline-grid"
  );
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

/** Minimal CSSOM surface the verified apply touches (real elements have it). */
interface StyleSurface {
  setProperty(property: string, value: string, priority?: string): void;
  getPropertyValue(property: string): string;
  getPropertyPriority(property: string): string;
  removeProperty(property: string): void;
}

/** Snapshot of a property's inline declaration (value + priority) for exact restore. */
export interface InlineSnapshot {
  value: string;
  priority: string;
}

function styleSurface(el: Element): StyleSurface | null {
  const s = (el as HTMLElement).style as unknown as Partial<StyleSurface> | undefined;
  return s?.setProperty && s.getPropertyValue && s.getPropertyPriority && s.removeProperty
    ? (s as StyleSurface)
    : null;
}

/** Read a property's current inline value + priority (empty strings when unset). */
export function readInlineSnapshot(el: Element, property: string): InlineSnapshot {
  const s = styleSurface(el);
  return {
    value: s?.getPropertyValue(property) ?? "",
    priority: s?.getPropertyPriority(property) ?? "",
  };
}

/**
 * Restore a property's inline declaration to a prior snapshot BYTE-IDENTICAL,
 * including its `!important` priority (an empty snapshot removes the declaration).
 * This is the exact-undo primitive the plan's R3 restore depends on. Never throws.
 */
export function restoreInlineSnapshot(
  el: Element,
  property: string,
  snap: InlineSnapshot,
): void {
  const s = styleSurface(el);
  if (!s) return;
  try {
    if (snap.value) s.setProperty(property, snap.value, snap.priority || "");
    else s.removeProperty(property);
  } catch {
    /* revert is best-effort; never throw into the host page */
  }
}

export interface VerifiedApply {
  /** True when even an `!important` escalation could not make the value take. */
  previewUnavailable: boolean;
}

/**
 * Apply a style value and VERIFY it took (U2). Writes inline, reads back the
 * computed value through the U1 normalization pipeline, and escalates that one
 * declaration to `!important` only when site CSS won; if even that loses, flags
 * `previewUnavailable` (the op still records the clean value — the escalation is
 * never part of the recorded intent).
 *
 * During BOTH the baseline read and the verify readback, the element's own
 * `transition` is neutralized (and restored byte-identical afterwards) so an
 * in-flight CSS transition cannot make the readback observe an intermediate frame
 * and trigger a false escalation / false preview-unavailable. Never throws.
 */
export function applyStyleVerified(
  el: Element,
  property: string,
  value: string,
  opts: { probe: ColorProbe; direction?: "ltr" | "rtl" },
): VerifiedApply {
  const s = styleSurface(el);
  if (!s) {
    // No CSSOM (e.g. the node doubles) — best-effort write, no verification.
    applyStylePreview(el, property, value);
    return { previewUnavailable: false };
  }
  const meta = getPropertyMeta(property);
  const ctx: PropCtx = { probe: opts.probe, direction: opts.direction };
  const prevTransition = readInlineSnapshot(el, "transition");
  try {
    s.setProperty("transition", "none", "important");
    const before = readComputedValue(el, property);
    s.setProperty(property, value);
    let after = readComputedValue(el, property);
    if (tookEffect(meta.canonical(value, ctx), meta.canonical(before, ctx), meta.canonical(after, ctx), before, after)) {
      return { previewUnavailable: false };
    }
    // Site CSS beat a plain inline write — escalate this one declaration.
    s.setProperty(property, value, "important");
    after = readComputedValue(el, property);
    const took = tookEffect(meta.canonical(value, ctx), meta.canonical(before, ctx), meta.canonical(after, ctx), before, after);
    return { previewUnavailable: !took };
  } catch {
    return { previewUnavailable: false };
  } finally {
    restoreInlineSnapshot(el, "transition", prevTransition);
  }
}

/**
 * The verified-apply predicate: did the target value take? Compares the NORMALIZED
 * computed-after against the normalized target (never authored-vs-computed raw
 * strings). Falls back to a raw-change check only when normalization is null.
 */
function tookEffect(
  targetCanon: string | null,
  beforeCanon: string | null,
  afterCanon: string | null,
  beforeRaw: string | null,
  afterRaw: string | null,
): boolean {
  if (targetCanon != null && afterCanon != null) return afterCanon === targetCanon;
  // Normalization unavailable: treat "the computed value moved" as success, and a
  // no-op write (target already equals before) as success too.
  if (afterRaw !== beforeRaw) return true;
  return targetCanon != null && beforeCanon != null && targetCanon === beforeCanon;
}

/** Apply an ephemeral plaintext preview to the live DOM. Never throws. */
export function applyTextPreview(el: Element, text: string): void {
  try {
    el.textContent = text;
  } catch {
    /* best-effort */
  }
}
