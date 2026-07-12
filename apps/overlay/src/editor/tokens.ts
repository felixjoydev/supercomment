/**
 * U11 — the design-token index + value-token matching.
 *
 * When an edit lands on a value that is actually a page design TOKEN (a CSS
 * custom property, e.g. `--brand-500`), we record the TOKEN NAME on the op so the
 * agent changes the token / theme rather than hard-coding a raw value, and we show
 * the reviewer that their pick matched a token.
 *
 * Two pieces:
 *   - {@link buildTokenIndex} statically walks the document's stylesheets
 *     (including adopted sheets and nested grouping rules) collecting every
 *     `--custom-property` declaration, cross-origin-safe (a sheet whose `cssRules`
 *     throws under CORS is silently skipped, mirroring `snapshot/serialize.ts`)
 *     and rule-capped so a huge stylesheet can't stall the walk.
 *   - {@link matchToken} resolves each candidate token AS APPLIED TO the selected
 *     element (so a theme-scoped token matches its element-resolved value, not the
 *     `:root` value) and compares normalized values; among matches the SHORTEST
 *     var-chain wins, deterministically.
 *
 * Every page access is behind an injectable seam so the index + matcher are unit-
 * tested under the node doubles; value-truth is proven on the U17 real-page matrix.
 */

/** A collected custom-property declaration: its name and its DECLARED value. */
export interface TokenDecl {
  /** The custom property name, including the leading `--`. */
  name: string;
  /** The declared value (may itself be `var(...)`, used for the chain-depth tiebreak). */
  value: string;
}

/** How many rules the static walk visits before stopping (DoS / jank bound). */
const DEFAULT_RULE_BUDGET = 20000;

export interface TokenIndexSeams {
  /** Override the raw declaration source (default: walk styleSheets + adopted). */
  declarations?: () => TokenDecl[];
  /** Max rules visited (default {@link DEFAULT_RULE_BUDGET}). */
  ruleBudget?: number;
}

/** A minimal CSS style surface: iterable property names + value lookup. */
interface StyleLike {
  readonly length: number;
  item?(i: number): string;
  [index: number]: string;
  getPropertyValue(name: string): string;
}
interface RuleLike {
  style?: StyleLike;
  cssRules?: ArrayLike<RuleLike>;
}
interface SheetLike {
  cssRules?: ArrayLike<RuleLike>;
}

/**
 * Build the document's custom-property index (first-seen order, deduped per name
 * on the FIRST declaration). Pure over its seams; never throws.
 */
export function buildTokenIndex(doc: Document, seams: TokenIndexSeams = {}): TokenDecl[] {
  const raw = seams.declarations?.() ?? walkSheets(doc, seams.ruleBudget ?? DEFAULT_RULE_BUDGET);
  const seen = new Set<string>();
  const out: TokenDecl[] = [];
  for (const decl of raw) {
    if (!decl.name.startsWith("--") || seen.has(decl.name)) continue;
    seen.add(decl.name);
    out.push({ name: decl.name, value: decl.value });
  }
  return out;
}

/** Default seam: walk same-origin stylesheets + adopted sheets for `--*` decls. */
function walkSheets(doc: Document, budget: number): TokenDecl[] {
  const out: TokenDecl[] = [];
  const state = { budget };
  const sheets: SheetLike[] = [];
  try {
    if (doc.styleSheets) for (let i = 0; i < doc.styleSheets.length; i++) sheets.push(doc.styleSheets[i] as SheetLike);
  } catch {
    /* best-effort */
  }
  try {
    const adopted = (doc as { adoptedStyleSheets?: SheetLike[] }).adoptedStyleSheets;
    if (adopted) for (const s of adopted) sheets.push(s);
  } catch {
    /* best-effort */
  }
  for (const sheet of sheets) {
    let rules: ArrayLike<RuleLike> | undefined;
    try {
      rules = sheet.cssRules; // cross-origin sheets throw here — skip them
    } catch {
      continue;
    }
    if (rules) collectRules(rules, out, state);
    if (state.budget <= 0) break;
  }
  return out;
}

/** Recurse rules (style + grouping) collecting custom-property declarations. */
function collectRules(rules: ArrayLike<RuleLike>, out: TokenDecl[], state: { budget: number }): void {
  for (let i = 0; i < rules.length; i++) {
    if (state.budget-- <= 0) return;
    const rule = rules[i];
    if (!rule) continue;
    const style = rule.style;
    if (style && typeof style.getPropertyValue === "function") {
      for (let j = 0; j < style.length; j++) {
        const name = style.item ? style.item(j) : style[j];
        if (name && name.startsWith("--")) {
          out.push({ name, value: (style.getPropertyValue(name) || "").trim() });
        }
      }
    }
    if (rule.cssRules) collectRules(rule.cssRules, out, state); // media/supports/layer/nested
  }
}

export interface TokenMatchSeams {
  /** Normalize a value for comparison (colors → canonical; else raw). Null = unusable. */
  normalize: (value: string) => string | null;
  /** The custom property's value AS RESOLVED ON the selected element (theme-correct). */
  resolveOnElement: (name: string) => string;
}

/**
 * The design token whose element-resolved value equals `target`, or null. Among
 * equal matches the token with the FEWEST `var(` in its declared value (the
 * shortest chain / most primitive) wins; ties break to the shorter, then
 * lexicographically smaller, name, so the choice is stable across runs.
 */
export function matchToken(
  index: TokenDecl[],
  target: string,
  seams: TokenMatchSeams,
): string | null {
  const normTarget = seams.normalize(target);
  if (normTarget == null) return null;
  let best: { name: string; depth: number } | null = null;
  for (const decl of index) {
    let resolved = "";
    try {
      resolved = seams.resolveOnElement(decl.name);
    } catch {
      resolved = "";
    }
    if (!resolved || !resolved.trim()) continue;
    if (seams.normalize(resolved) !== normTarget) continue;
    const depth = (decl.value.match(/var\(/g) ?? []).length;
    if (best == null || depth < best.depth || (depth === best.depth && isShorter(decl.name, best.name))) {
      best = { name: decl.name, depth };
    }
  }
  return best?.name ?? null;
}

/** Deterministic name ordering: shorter first, then lexicographic. */
function isShorter(a: string, b: string): boolean {
  return a.length < b.length || (a.length === b.length && a < b);
}
