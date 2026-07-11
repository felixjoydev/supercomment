/**
 * U10 — the page color palette.
 *
 * Collects the colors a page actually uses so the color picker can offer them as
 * one-click swatches. Two signals, unioned and deduped:
 *
 *   1. a STATIC pass over the document's stylesheets (the color-valued
 *      declarations authors wrote), and
 *   2. a bounded COMPUTED scan of the page's elements (what actually renders,
 *      including CSS-variable and framework-injected colors).
 *
 * Every candidate is resolved through the U1 {@link canonicalColor} pipeline, so
 * an `oklch(...)` and its `rgb(...)` equivalent collapse to one swatch and modern
 * syntaxes are handled uniformly; fully-transparent values are dropped (not a
 * useful swatch). The result is deduped on the canonical hex8 in first-seen order
 * and capped so an adversarial page can't produce an unbounded list.
 *
 * All page access is behind injectable seams so the dedupe/normalize logic is
 * unit-tested under the node doubles (no stylesheets / getComputedStyle there);
 * color value-truth is proven on the U17 real-page matrix.
 */
import { canonicalColor, type ColorProbe } from "./normalize.js";

/** The color properties whose values are worth harvesting for the palette. */
const COLOR_PROPS = [
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "fill",
  "stroke",
  "text-decoration-color",
  "caret-color",
] as const;

const DEFAULT_SCAN_LIMIT = 3000;
const DEFAULT_MAX_SWATCHES = 24;

export interface PaletteSeams {
  /** The shared color probe (canvas readback in the browser; basic in tests). */
  probe: ColorProbe;
  /** Raw color strings from a static stylesheet pass (default: reads styleSheets). */
  stylesheetColors?: () => string[];
  /** Elements to computed-scan (default: `doc.querySelectorAll("*")`). */
  elements?: Iterable<Element>;
  /** A single element's color-valued computed values (default: getComputedStyle). */
  computedColors?: (el: Element) => string[];
  /** Max elements scanned (DoS bound). */
  scanLimit?: number;
  /** Max swatches returned. */
  maxSwatches?: number;
}

/**
 * Extract the page's color palette as canonical hex8 strings (lowercase),
 * deduped in first-seen order and capped. Pure over its seams; safe on any page.
 */
export function extractPalette(doc: Document, seams: PaletteSeams): string[] {
  const scanLimit = seams.scanLimit ?? DEFAULT_SCAN_LIMIT;
  const maxSwatches = seams.maxSwatches ?? DEFAULT_MAX_SWATCHES;
  const computedColors = seams.computedColors ?? ((el: Element) => readComputedColors(doc, el));

  const seen = new Set<string>();
  const out: string[] = [];
  const consider = (raw: string): void => {
    if (out.length >= maxSwatches) return;
    const canon = canonicalColor(raw, seams.probe);
    if (!canon || canon === "transparent") return;
    if (seen.has(canon)) return;
    seen.add(canon);
    out.push(canon);
  };

  // 1) Static stylesheet declarations first (author intent, most meaningful).
  for (const raw of seams.stylesheetColors?.() ?? readStylesheetColors(doc)) {
    consider(raw);
    if (out.length >= maxSwatches) return out;
  }

  // 2) Computed scan of the page's elements (bounded).
  let scanned = 0;
  const elements = seams.elements ?? safeQueryAll(doc);
  for (const el of elements) {
    if (scanned >= scanLimit || out.length >= maxSwatches) break;
    for (const raw of computedColors(el)) consider(raw);
    scanned += 1;
  }
  return out;
}

/** Default seam: color-valued declarations across the document's stylesheets. */
function readStylesheetColors(doc: Document): string[] {
  const out: string[] = [];
  try {
    const sheets = doc.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      let rules: CSSRuleList | undefined;
      try {
        rules = sheets[i]?.cssRules; // cross-origin sheets throw here — skip them
      } catch {
        continue;
      }
      if (!rules) continue;
      for (let j = 0; j < rules.length; j++) {
        const style = (rules[j] as CSSStyleRule).style;
        if (!style?.getPropertyValue) continue;
        for (const prop of COLOR_PROPS) {
          const v = style.getPropertyValue(prop);
          if (v && v.trim()) out.push(v.trim());
        }
      }
    }
  } catch {
    /* best-effort */
  }
  return out;
}

/** Default seam: an element's color-valued computed styles. */
function readComputedColors(doc: Document, el: Element): string[] {
  try {
    const win = doc.defaultView as
      | { getComputedStyle?: (e: Element) => { getPropertyValue?: (p: string) => string } }
      | undefined;
    const cs = win?.getComputedStyle?.(el);
    if (!cs?.getPropertyValue) return [];
    const out: string[] = [];
    for (const prop of COLOR_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v && v.trim()) out.push(v.trim());
    }
    return out;
  } catch {
    return [];
  }
}

/** `querySelectorAll("*")` guarded so an odd document can't throw. */
function safeQueryAll(doc: Document): Iterable<Element> {
  try {
    return doc.querySelectorAll("*");
  } catch {
    return [];
  }
}
