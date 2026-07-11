/**
 * U7 — Google font loading with clean failure detection.
 *
 * Loads a catalog family onto the reviewer's page by fetching the css2 stylesheet
 * text, parsing its `@font-face` blocks, and constructing real `FontFace` objects
 * added to the document's FontFaceSet. Success is the per-face `load()` promise
 * raced against a ~3.5 s deadline. The result is honest about failure so the op
 * can carry `previewUnavailable` when the screenshot won't reflect the choice:
 *
 *   - the font binary is only constructed from the allow-listed
 *     `fonts.gstatic.com` origin (a css2 response pointing anywhere else is
 *     dropped); the family name validates against a strict charset and is
 *     URL-encoded into the css2 request; nothing but the family/weights is trusted
 *     from the response;
 *   - a `securitypolicyviolation` listener labels a CSP block distinctly from a
 *     network failure, so the reviewer learns their host page's CSP forbids the
 *     font rather than seeing a generic error;
 *   - the 3.5 s deadline result is PROVISIONAL: after timing out the loader stays
 *     subscribed to the underlying load promise and calls `onLateResolve` if the
 *     face eventually loads, so the caller can clear the degradation badge and
 *     strip `previewUnavailable` from any pending (unsaved) op that named it.
 *
 * Every seam (fetch, the FontFace constructor, the FontFaceSet, the timer) is
 * injectable so the load state machine is unit-tested deterministically; the real
 * browser wiring is defaulted from `globalThis`.
 */
import { FontRegistry, type RegistryDocLike } from "./registry.js";

/** The one origin a font binary may load from (allow-list). */
export const GSTATIC_ORIGIN = "https://fonts.gstatic.com";
/** The css2 endpoint the reviewer's page fetches font metadata from. */
export const GOOGLE_CSS2_ENDPOINT = "https://fonts.googleapis.com/css2";

/** Minimal FontFace surface the loader touches. */
export interface FontFaceLike {
  readonly family: string;
  readonly weight: string;
  readonly style: string;
  readonly status: string;
  load(): Promise<FontFaceLike>;
}
export type FontFaceCtor = new (
  family: string,
  source: string,
  descriptors?: { weight?: string; style?: string; display?: string },
) => FontFaceLike;

export interface FontFaceSetLike {
  add(face: FontFaceLike): unknown;
  delete(face: FontFaceLike): unknown;
}
export interface FontDocLike extends RegistryDocLike {
  readonly fonts: FontFaceSetLike;
  addEventListener?(type: string, cb: (e: unknown) => void, opts?: unknown): void;
  removeEventListener?(type: string, cb: (e: unknown) => void, opts?: unknown): void;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init?: unknown) => Promise<FetchResponseLike>;

export interface Scheduler {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type FontLoadReason =
  | "invalid"
  | "network"
  | "csp"
  | "timeout"
  | "no-faces"
  | "load-error";

export interface FontLoadResult {
  ok: boolean;
  family: string;
  /** Weights actually parsed/installed (for the picker's weight list). */
  weights: string[];
  /** The preview could not be confirmed; the op should carry previewUnavailable. */
  previewUnavailable: boolean;
  /** Failure reason when `ok` is false. */
  reason?: FontLoadReason;
}

export interface LoadFontOptions {
  doc: FontDocLike;
  fetch: FetchLike;
  FontFace: FontFaceCtor;
  /** Session registry so the added faces are removed on discard/exit. */
  registry?: FontRegistry;
  /** Timer seam (default: globalThis setTimeout/clearTimeout). */
  scheduler?: Scheduler;
  /** Race deadline in ms (default 3500). */
  deadlineMs?: number;
  /** Requested weights (numeric strings or a "100 900" variable range). */
  weights?: string[];
  /** font-display descriptor (default "swap"). */
  display?: string;
  /** css2 endpoint override (tests). */
  cssEndpoint?: string;
  /** Called if the face resolves AFTER the deadline (provisional-race recovery). */
  onLateResolve?: (family: string) => void;
}

const DEFAULT_DEADLINE_MS = 3500;

/** A family name is safe iff it is letters/digits/spaces/hyphen only. */
export function isValidFamilyName(family: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(family.trim());
}

/** URL-encode a (validated) family for the css2 `family=` param (spaces → `+`). */
function encodeFamily(family: string): string {
  return family.trim().replace(/\s+/g, "+");
}

/**
 * Build the css2 `wght@` axis from requested weights. A range value ("100 900")
 * becomes `100..900`; discrete weights are deduped, sorted ascending, `;`-joined.
 */
export function weightAxis(weights: string[]): string {
  const range = weights.find((w) => /\d+\s+\d+/.test(w));
  if (range) {
    const [lo, hi] = range.trim().split(/\s+/);
    return `${lo}..${hi}`;
  }
  const nums = [...new Set(weights.map((w) => w.trim()).filter((w) => /^\d+$/.test(w)))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return (nums.length ? nums : ["400"]).join(";");
}

/** Build the css2 request URL for a family + weights. */
export function buildCss2Url(
  family: string,
  weights: string[],
  opts: { endpoint?: string; display?: string } = {},
): string {
  const endpoint = opts.endpoint ?? GOOGLE_CSS2_ENDPOINT;
  const display = opts.display ?? "swap";
  return `${endpoint}?family=${encodeFamily(family)}:wght@${weightAxis(weights)}&display=${display}`;
}

/** A parsed css2 `@font-face` descriptor. */
export interface ParsedFace {
  weight: string;
  url: string;
}

/**
 * Parse the `@font-face` blocks of a css2 response into weight+url descriptors.
 * Only the first `url(...)` of each block is taken (css2 lists a single src url per
 * face). Robust to quoted/unquoted urls and missing weights (defaults to 400).
 */
export function parseFontFaces(css: string): ParsedFace[] {
  const faces: ParsedFace[] = [];
  const blockRe = /@font-face\s*{([^}]*)}/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(css)) !== null) {
    const body = block[1] ?? "";
    const urlMatch = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(body);
    if (!urlMatch || !urlMatch[2]) continue;
    const weightMatch = /font-weight\s*:\s*([^;]+);/i.exec(body);
    const weight = weightMatch ? weightMatch[1]!.trim().replace(/\s+/g, " ") : "400";
    faces.push({ weight, url: urlMatch[2].trim() });
  }
  return faces;
}

/** True when a url loads its binary from the allow-listed gstatic origin. */
export function isGstaticUrl(url: string): boolean {
  try {
    return new URL(url).origin === GSTATIC_ORIGIN;
  } catch {
    return false;
  }
}

function defaultScheduler(): Scheduler {
  const g = globalThis as unknown as Scheduler;
  return {
    setTimeout: (cb, ms) => g.setTimeout(cb, ms),
    clearTimeout: (h) => g.clearTimeout(h),
  };
}

/** Does a CSP violation event implicate the font/style load we just started? */
function isFontCspViolation(e: unknown): boolean {
  const v = e as { blockedURI?: string; violatedDirective?: string } | null;
  if (!v) return false;
  const uri = String(v.blockedURI ?? "");
  const dir = String(v.violatedDirective ?? "");
  return (
    uri.includes("fonts.gstatic.com") ||
    uri.includes("fonts.googleapis.com") ||
    dir.startsWith("font-src") ||
    dir.startsWith("style-src")
  );
}

/**
 * Load a Google catalog family onto the page. Resolves with an honest result:
 * `ok` on a confirmed load, otherwise a labeled failure with `previewUnavailable`
 * so the op can tell the agent to trust the value over the screenshot.
 */
export async function loadGoogleFont(
  family: string,
  opts: LoadFontOptions,
): Promise<FontLoadResult> {
  const weights = opts.weights && opts.weights.length ? opts.weights : ["400"];
  if (!isValidFamilyName(family)) {
    return { ok: false, family, weights, previewUnavailable: true, reason: "invalid" };
  }

  const scheduler = opts.scheduler ?? defaultScheduler();
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;

  // Distinct CSP-block detection over the load window.
  let cspBlocked = false;
  const cspListener = (e: unknown): void => {
    if (isFontCspViolation(e)) cspBlocked = true;
  };
  const doc = opts.doc;
  doc.addEventListener?.("securitypolicyviolation", cspListener);
  const detachCsp = (): void =>
    doc.removeEventListener?.("securitypolicyviolation", cspListener);

  // 1) Fetch the css2 metadata.
  let cssText: string;
  try {
    const res = await opts.fetch(buildCss2Url(family, weights, {
      endpoint: opts.cssEndpoint,
      display: opts.display,
    }));
    if (!res.ok) {
      detachCsp();
      return fail(family, weights, cspBlocked ? "csp" : "network");
    }
    cssText = await res.text();
  } catch {
    detachCsp();
    return fail(family, weights, cspBlocked ? "csp" : "network");
  }

  // 2) Parse faces and keep only allow-listed gstatic binaries.
  const parsed = parseFontFaces(cssText).filter((f) => isGstaticUrl(f.url));
  if (parsed.length === 0) {
    detachCsp();
    return fail(family, weights, cspBlocked ? "csp" : "no-faces");
  }
  const installedWeights = [...new Set(parsed.map((f) => f.weight))];

  // 3) Construct + register + start loading each face.
  const loadPromises: Promise<FontFaceLike>[] = [];
  for (const f of parsed) {
    try {
      const face = new opts.FontFace(family, `url(${f.url})`, {
        weight: f.weight,
        style: "normal",
        display: opts.display ?? "swap",
      });
      opts.registry?.track(doc, face);
      doc.fonts.add(face);
      loadPromises.push(Promise.resolve(face.load()));
    } catch {
      // A single face that fails to construct/add must not abort the rest.
    }
  }
  if (loadPromises.length === 0) {
    detachCsp();
    return fail(family, installedWeights, cspBlocked ? "csp" : "load-error");
  }

  // 4) Race the settle against the deadline (the result is provisional on timeout).
  const settled = Promise.allSettled(loadPromises);
  let timedOut = false;
  const deadline = new Promise<void>((resolve) => {
    const handle = scheduler.setTimeout(() => {
      timedOut = true;
      resolve();
    }, deadlineMs);
    void settled.then(() => scheduler.clearTimeout(handle));
  });
  await Promise.race([settled, deadline]);
  detachCsp();

  if (!timedOut) {
    const results = await settled;
    if (cspBlocked) return fail(family, installedWeights, "csp");
    const anyRejected = results.some((r) => r.status === "rejected");
    if (anyRejected) return fail(family, installedWeights, "load-error");
    return { ok: true, family, weights: installedWeights, previewUnavailable: false };
  }

  // Timed out — provisional failure; stay subscribed for a late success.
  void settled.then((results) => {
    const allOk = results.every((r) => r.status === "fulfilled");
    if (allOk && !cspBlocked) opts.onLateResolve?.(family);
  });
  return fail(family, installedWeights, "timeout");
}

function fail(family: string, weights: string[], reason: FontLoadReason): FontLoadResult {
  return { ok: false, family, weights, previewUnavailable: true, reason };
}
