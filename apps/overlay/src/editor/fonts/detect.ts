/**
 * U7 — page font detection.
 *
 * Answers "which fonts is this page actually using?" so the picker (U8) can list
 * the real page families first, and so a `font-family` op can record the true
 * identity. Detection is the union of two signals:
 *
 *   1. the computed `font-family` stacks of a bounded element scan (what the page
 *      *asks* to render), keyed by the primary family token; and
 *   2. the deduped `document.fonts` entries (what actually *loaded*), collapsed
 *      per family across unicode-range subsets.
 *
 * Two correctness rules from the plan are enforced here:
 *
 *   - **Webfont attribution gate.** A family is only reported as `loaded` (a real
 *     face backs it) when a loaded, NON-fallback `FontFace` matches it. A
 *     `next/font` metric-adjusted fallback (`__Inter_Fallback_abc123`) is a loaded
 *     FontFace too, so counting it would mistake the fallback for the real family;
 *     we exclude fallback artifacts from the attribution. Optional measurement is
 *     only a tie-breaker AMONG already-loaded faces — it can never promote a face
 *     the status gate rejects.
 *   - **Mangled-name normalization.** `next/font` mangles families to
 *     `__Inter_abc123` / `__Roboto_Mono_abc123`; we normalize those to a display
 *     identity ("Inter" / "Roboto Mono") but always keep the `raw` token so a
 *     mangled artifact is never recorded as the identity without the true stack.
 *
 * Everything is driven through injectable seams so the pure logic is unit-tested
 * under the node doubles (no `getComputedStyle` / canvas there); value-truth for
 * the measurement path is proven on the U17 real-page matrix.
 */

/** A font the page renders, with the signal used to rank + attribute it. */
export interface DetectedFont {
  /** Human display family name (framework-mangled artifacts normalized out). */
  family: string;
  /** The primary family token exactly as it appeared on the page (may be mangled). */
  raw: string;
  /** How many scanned elements render primarily in this family (ranking signal). */
  count: number;
  /** A real (loaded, non-fallback) `FontFace` backs this family. */
  loaded: boolean;
  /** A CSS generic keyword (`sans-serif`, `serif`, `monospace`, …). */
  generic: boolean;
}

/** A `document.fonts` entry reduced to the two fields detection needs. */
export interface FontFaceStatus {
  family: string;
  /** `FontFace.status`: "unloaded" | "loading" | "loaded" | "error". */
  status: string;
}

export interface DetectSeams {
  /** Elements to scan (default: `doc.querySelectorAll("*")`). */
  elements?: Iterable<Element>;
  /** Primary computed `font-family` stack for an element (default: getComputedStyle). */
  computedFamily?: (el: Element) => string | null;
  /** Loaded `FontFace` entries + status (default: reads `document.fonts`). */
  loadedFaces?: () => FontFaceStatus[];
  /**
   * Optional measurement seam: the rendered width of a long mixed-glyph sample in
   * a given font stack (a canvas `measureText`). Used ONLY to confirm that an
   * already-loaded face is really the rendered one; it can demote a declared face
   * that renders identically to the generic baseline, but never promote a face the
   * FontFace.status gate rejected. Absent in most callers.
   */
  measure?: (fontStack: string, sample: string) => number;
  /** Max elements scanned — a DoS bound on adversarial pages (default 4000). */
  scanLimit?: number;
}

/** CSS generic font families — never a concrete face, always rank last. */
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/** A long, glyph-diverse sample so metric differences between faces show up. */
const MEASURE_SAMPLE =
  "The quick brown fox jumps over the lazy dog 0123456789 WWWMMMiiilll";

const DEFAULT_SCAN_LIMIT = 4000;

/** True for a CSS generic family keyword (case-insensitive). */
export function isGenericFamily(name: string): boolean {
  return GENERIC_FAMILIES.has(name.trim().toLowerCase());
}

/**
 * A `next/font` metric-adjusted fallback artifact, e.g. `__Inter_Fallback_abc123`
 * or a bare `_Fallback...`. These are loaded FontFaces that must NOT be counted as
 * the real webfont (the attribution gate).
 */
export function isFallbackArtifact(raw: string): boolean {
  return /(?:^|_)_?fallback/i.test(raw.trim().replace(/^['"]+|['"]+$/g, ""));
}

/**
 * The primary (first) family token of a CSS `font-family` stack, de-quoted, or ""
 * when the stack is empty. `'"Inter", sans-serif'` → `Inter`.
 */
export function firstFamilyToken(stack: string | null): string {
  if (stack == null) return "";
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^['"]+|['"]+$/g, "").trim();
}

/**
 * Normalize a framework-mangled family name to a human display identity. Rewrites
 * `next/font` artifacts (`__Inter_abc123`, `__Roboto_Mono_abc123`,
 * `__Inter_Fallback_abc123`) to "Inter" / "Roboto Mono"; leaves any ordinary
 * family name (and any name that does not match the mangling signature) untouched.
 */
export function normalizeFamilyName(raw: string): string {
  const s = raw.trim().replace(/^['"]+|['"]+$/g, "").trim();
  // next/font signature: a `__` prefix, the (space→underscore) family, an optional
  // `_Fallback` marker, then a `_<hash>` suffix.
  const m = /^__(.+?)(?:_Fallback)?_[0-9a-z]{4,}$/i.exec(s);
  if (m && m[1]) return m[1].replace(/_/g, " ").trim();
  return s;
}

/** Default seam: read a live `document.fonts` FontFaceSet into status entries. */
function readLoadedFaces(doc: Document): FontFaceStatus[] {
  try {
    const set = (doc as { fonts?: Iterable<{ family?: string; status?: string }> }).fonts;
    if (!set || typeof (set as { forEach?: unknown }).forEach !== "function") return [];
    const out: FontFaceStatus[] = [];
    (set as unknown as Set<{ family?: string; status?: string }>).forEach((f) => {
      if (typeof f.family === "string") {
        out.push({ family: f.family, status: typeof f.status === "string" ? f.status : "unloaded" });
      }
    });
    return out;
  } catch {
    return [];
  }
}

/** Default seam: the element's primary computed `font-family` stack. */
function readComputedFamily(doc: Document, el: Element): string | null {
  try {
    const win = doc.defaultView as
      | { getComputedStyle?: (e: Element) => { fontFamily?: string } }
      | undefined;
    const v = win?.getComputedStyle?.(el)?.fontFamily;
    return v != null && v.trim() !== "" ? v : null;
  } catch {
    return null;
  }
}

/** Does an already-loaded family render distinctly from the generic baseline? */
function measureConfirms(
  family: string,
  measure: (fontStack: string, sample: string) => number,
): boolean {
  try {
    const withFont = measure(`"${family}", monospace`, MEASURE_SAMPLE);
    const baseline = measure("monospace", MEASURE_SAMPLE);
    if (!Number.isFinite(withFont) || !Number.isFinite(baseline)) return true;
    return Math.abs(withFont - baseline) > 0.5;
  } catch {
    return true;
  }
}

/**
 * Detect the fonts a page uses, ranked with its actual rendered families first.
 * Pure over its seams; safe to call on any page.
 */
export function detectPageFonts(doc: Document, seams: DetectSeams = {}): DetectedFont[] {
  const scanLimit = seams.scanLimit ?? DEFAULT_SCAN_LIMIT;
  const computedFamily = seams.computedFamily ?? ((el: Element) => readComputedFamily(doc, el));

  // 1) Which families really loaded, deduped per family across unicode-ranges.
  //    Track only real (non-fallback) loaded faces for the attribution gate, and
  //    remember a display name per family so a scan-absent face still lists well.
  const realLoaded = new Set<string>();
  const displayName = new Map<string, string>();
  for (const face of seams.loadedFaces?.() ?? readLoadedFaces(doc)) {
    if (isFallbackArtifact(face.family)) continue; // never a real family identity
    const norm = normalizeFamilyName(face.family);
    const key = norm.toLowerCase();
    if (!displayName.has(key)) displayName.set(key, norm);
    if (face.status === "loaded") realLoaded.add(key);
  }

  // 2) Scan the page's computed stacks, counting the primary family per element.
  const map = new Map<string, DetectedFont>();
  const upsert = (raw: string): void => {
    const family = normalizeFamilyName(raw);
    const key = family.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    map.set(key, {
      family,
      raw,
      count: 1,
      loaded: false,
      generic: isGenericFamily(family),
    });
  };

  let scanned = 0;
  const elements = seams.elements ?? safeQueryAll(doc);
  for (const el of elements) {
    if (scanned >= scanLimit) break;
    const raw = firstFamilyToken(computedFamily(el));
    if (!raw) continue;
    upsert(raw);
    scanned += 1;
  }

  // 3) Attribute loaded state (status gate, then optional measurement demotion).
  for (const df of map.values()) {
    const key = df.family.toLowerCase();
    const statusLoaded = realLoaded.has(key);
    df.loaded =
      statusLoaded && (seams.measure ? measureConfirms(df.family, seams.measure) : true);
  }

  // 4) Add loaded families that never surfaced in the scan (still page fonts),
  //    using the display name recovered from their FontFace.
  for (const [key, name] of displayName) {
    if (map.has(key)) continue;
    map.set(key, {
      family: name,
      raw: name,
      count: 0,
      loaded: realLoaded.has(key),
      generic: isGenericFamily(name),
    });
  }

  return [...map.values()].sort(rankFonts);
}

/** Ranking: most-rendered first, concrete before generic, loaded before not. */
function rankFonts(a: DetectedFont, b: DetectedFont): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.generic !== b.generic) return a.generic ? 1 : -1;
  if (a.loaded !== b.loaded) return a.loaded ? -1 : 1;
  return a.family.localeCompare(b.family);
}

/** `querySelectorAll("*")` guarded so a hostile/odd document can't throw. */
function safeQueryAll(doc: Document): Iterable<Element> {
  try {
    return doc.querySelectorAll("*");
  } catch {
    return [];
  }
}
