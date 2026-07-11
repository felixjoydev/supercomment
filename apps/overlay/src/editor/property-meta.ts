/**
 * U1 — the editable-property registry (read-truth layer).
 *
 * One place that describes each editable CSS property: how to turn its COMPUTED
 * value into what a control displays, how to turn a raw control value into the
 * CSS to write (unit + range), which enumerated option a computed value should
 * press, and a canonical comparable form for equality. Panel initializers and
 * commits both go through it, so the systemic read-side defects are fixed once:
 *
 *   - line-height reads AND writes px (a `+1` from `25.6px` is `26.6px`, not a
 *     25.6x multiplier);
 *   - letter-spacing shows `0` for the computed keyword `normal` (blank before),
 *     while the recorded `before` stays the true `normal`;
 *   - text-align maps the computed default `start` to the pressed Left segment on
 *     LTR content (RTL flips), so a segment is always pressed;
 *   - colours resolve through the shared {@link canonicalColor} pipeline.
 *
 * The registry is pure and directly unit-tested; colour value-truth (the canvas
 * readback) is proven on the U17 real-page matrix.
 */
import type { ColorProbe } from "./color/normalize.js";
import { canonicalColor } from "./color/normalize.js";

export type PropKind =
  | "length" // numeric with a unit (px)
  | "number" // numeric, unitless
  | "color"
  | "keyword" // enumerated / string keyword
  | "font-family"
  | "raw"; // anything else — identity

export interface PropCtx {
  /** Writing direction of the element, for start/end keyword mapping. */
  direction?: "ltr" | "rtl";
  /** The colour probe, required to canonicalize colour-valued properties. */
  probe?: ColorProbe;
}

export interface PropertyMeta {
  readonly property: string;
  readonly kind: PropKind;
  /** Unit appended on write for numeric kinds; "" for unitless / non-numeric. */
  readonly unit: string;
  /** Default stepper increment. */
  readonly step: number;
  readonly allowNegative: boolean;
  /** Computed value → the string a numeric/keyword control displays ("" if none). */
  displayFrom(computed: string | null, ctx?: PropCtx): string;
  /** Raw control value → the CSS value to write. */
  toCss(raw: string, ctx?: PropCtx): string;
  /** Does `optionValue` represent `computed`? (drives which segment/option presses.) */
  matchesOption(optionValue: string, computed: string | null, ctx?: PropCtx): boolean;
  /** Canonical comparable form (projection equal-drop); null when empty. */
  canonical(value: string | null, ctx?: PropCtx): string | null;
}

/** Parse a length/number computed value to a trimmed number string, or "". */
function numericDisplay(computed: string | null): string {
  if (computed == null) return "";
  const n = parseFloat(computed);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "";
}

/** Canonical numeric form ("0px" / "0" / "0.0" → "0"), or null. */
function numericCanonical(value: string | null): string | null {
  if (value == null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : null;
}

/** Resolve start/end for the given writing direction. */
function resolveLogical(value: string, ctx?: PropCtx): string {
  const dir = ctx?.direction === "rtl" ? "rtl" : "ltr";
  if (value === "start") return dir === "rtl" ? "right" : "left";
  if (value === "end") return dir === "rtl" ? "left" : "right";
  return value;
}

interface Overrides {
  unit?: string;
  step?: number;
  allowNegative?: boolean;
  displayFrom?: (computed: string | null, ctx?: PropCtx) => string;
  toCss?: (raw: string, ctx?: PropCtx) => string;
  matchesOption?: (optionValue: string, computed: string | null, ctx?: PropCtx) => boolean;
  canonical?: (value: string | null, ctx?: PropCtx) => string | null;
}

function defineProp(property: string, kind: PropKind, o: Overrides = {}): PropertyMeta {
  const unit = o.unit ?? (kind === "length" ? "px" : "");
  const step = o.step ?? 1;
  const allowNegative = o.allowNegative ?? false;

  const displayFrom =
    o.displayFrom ??
    ((computed: string | null): string =>
      kind === "length" || kind === "number"
        ? numericDisplay(computed)
        : computed ?? "");

  const toCss =
    o.toCss ??
    ((raw: string): string =>
      kind === "length" || kind === "number" ? `${raw}${unit}` : raw);

  const canonical =
    o.canonical ??
    ((value: string | null, ctx?: PropCtx): string | null => {
      if (kind === "length" || kind === "number") return numericCanonical(value);
      if (kind === "color") {
        return ctx?.probe ? canonicalColor(value, ctx.probe) : (value?.trim().toLowerCase() ?? null);
      }
      const v = value == null ? null : value.trim().toLowerCase();
      return v === "" ? null : v;
    });

  const matchesOption =
    o.matchesOption ??
    ((optionValue: string, computed: string | null, ctx?: PropCtx): boolean => {
      const a = canonical(optionValue, ctx);
      const b = canonical(computed, ctx);
      return a != null && a === b;
    });

  return { property, kind, unit, step, allowNegative, displayFrom, toCss, matchesOption, canonical };
}

// --- Keyword equivalence for logical alignment values ------------------------

/** text-align: default `start` presses Left (LTR) / Right (RTL); a segment always presses. */
const textAlign = defineProp("text-align", "keyword", {
  canonical: (value, ctx) => {
    const v = (value == null || value.trim() === "" ? "start" : value.trim().toLowerCase());
    return resolveLogical(v, ctx);
  },
});

/** align-items: computed `normal` behaves as `stretch`. */
const alignItems = defineProp("align-items", "keyword", {
  canonical: (value) => {
    const v = value == null || value.trim() === "" ? "normal" : value.trim().toLowerCase();
    return v === "normal" ? "stretch" : v;
  },
});

/** justify-content: computed `normal` behaves as `flex-start`. */
const justifyContent = defineProp("justify-content", "keyword", {
  canonical: (value) => {
    const v = value == null || value.trim() === "" ? "normal" : value.trim().toLowerCase();
    return v === "normal" ? "flex-start" : v;
  },
});

const REGISTRY: Record<string, PropertyMeta> = Object.fromEntries(
  [
    // Type / text
    defineProp("font-size", "length", { step: 1 }),
    defineProp("line-height", "length", { step: 1 }), // px both sides — the marquee fix
    defineProp("letter-spacing", "length", {
      step: 0.5,
      allowNegative: true,
      // computed keyword "normal" shows 0 (the true `normal` is preserved as `before`).
      displayFrom: (computed) =>
        computed == null || computed.trim().toLowerCase() === "normal"
          ? computed == null
            ? ""
            : "0"
          : numericDisplay(computed),
      // `normal` and `0` are the same rendered spacing.
      canonical: (value) => {
        if (value == null) return null;
        const t = value.trim().toLowerCase();
        if (t === "" ) return null;
        if (t === "normal") return "0";
        return numericCanonical(value);
      },
    }),
    defineProp("font-weight", "keyword", { step: 100 }),
    defineProp("font-family", "font-family"),
    textAlign,
    // Layout
    defineProp("flex-direction", "keyword"),
    alignItems,
    justifyContent,
    defineProp("gap", "length", { step: 1 }),
    defineProp("display", "keyword"),
    // Spacing
    defineProp("padding-top", "length"),
    defineProp("padding-right", "length"),
    defineProp("padding-bottom", "length"),
    defineProp("padding-left", "length"),
    defineProp("margin-top", "length", { allowNegative: true }),
    defineProp("margin-right", "length", { allowNegative: true }),
    defineProp("margin-bottom", "length", { allowNegative: true }),
    defineProp("margin-left", "length", { allowNegative: true }),
    // Size
    defineProp("width", "length"),
    defineProp("height", "length"),
    // Effects (U18 — the remaining R13 controls)
    defineProp("border-radius", "length"),
    defineProp("border-top-left-radius", "length"),
    defineProp("border-top-right-radius", "length"),
    defineProp("border-bottom-right-radius", "length"),
    defineProp("border-bottom-left-radius", "length"),
    defineProp("border-width", "length"),
    defineProp("border-style", "keyword"),
    defineProp("border-color", "color"),
    defineProp("box-shadow", "raw"),
    defineProp("text-transform", "keyword"),
    defineProp("text-decoration-line", "keyword"),
    defineProp("font-style", "keyword"),
    // Colour
    defineProp("color", "color"),
    defineProp("background-color", "color"),
    defineProp("opacity", "number", { step: 0.1 }),
    // Position
    defineProp("place-self", "keyword"),
  ].map((m) => [m.property, m]),
);

/** The registry entry for a property, or a generic `raw` fallback. */
export function getPropertyMeta(property: string): PropertyMeta {
  return REGISTRY[property] ?? defineProp(property, "raw");
}
