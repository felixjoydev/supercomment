/**
 * U7 (read) — resolving a comment's captured "before" artifact / screenshot for
 * display in the dashboard.
 *
 * A real raster is stored in the PRIVATE `captures` Storage bucket as an object
 * PATH (`<previewId>/<uuid>.<ext>`), not a URL. To show it the dashboard signs
 * the path into a short-lived URL with the member session (0027 RLS SELECT via
 * is_preview_workspace_member). Inline `image/*` data URLs and the DOM-snapshot
 * fallback (`data:application/json,…`) need no resolution.
 *
 * Pure + framework-free so the classification + resolution logic is node-testable
 * (the React component is a thin consumer; the live Storage round-trip is
 * VERIFY IN REAL ENV).
 */

/** The private bucket created in migration 0027 (mirrors the overlay upload). */
export const CAPTURES_BUCKET = 'captures';

/** How a stored screenshot value should be rendered. */
export type CaptureKind = 'none' | 'image-url' | 'image-ref' | 'snapshot';

/** Signs a private-bucket object path into a temporary URL; null on failure. */
export type CaptureSigner = (
  bucket: string,
  path: string,
) => Promise<string | null>;

/**
 * Classify a stored `context.screenshot` (or reference-image) value:
 *  - `none`      — absent/empty.
 *  - `image-url` — directly renderable: ONLY an `image/*` data URL.
 *  - `snapshot`  — the non-image DOM-snapshot fallback (`data:application/json,…`
 *                  or any other non-image `data:` URL) → show an indicator.
 *  - `image-ref` — a `captures` object PATH that must be signed before it renders.
 *
 * M5: a guest-supplied ABSOLUTE URL is deliberately NOT `image-url`. `context`
 * is guest-controlled, and screenshots are only ever stored as a `captures`
 * bucket PATH or an inline `data:image/*` URL — never an http(s) URL. Rendering
 * a guest-set `https://attacker/…` as an <img src> would make the reviewing
 * member's browser fetch that origin (IP/UA/timing leak + intranet-GET SSRF), so
 * any non-`data:` value is treated as a bucket path and signed on read; an
 * attacker URL simply fails to sign → null → nothing is fetched.
 */
export function classifyCaptureRef(src: string | null | undefined): CaptureKind {
  if (!src) return 'none';
  if (src.startsWith('data:image/')) return 'image-url';
  if (src.startsWith('data:')) return 'snapshot';
  return 'image-ref';
}

/**
 * Resolve a stored value to a directly-renderable image URL, or `null` when it
 * is not a resolvable image (snapshot/none) or signing failed. A value that is
 * already a URL / image data URL is returned unchanged; a `captures` object path
 * is signed via {@link CaptureSigner}. Never throws.
 */
export async function resolveCaptureSrc(
  src: string | null | undefined,
  signer: CaptureSigner,
): Promise<string | null> {
  const kind = classifyCaptureRef(src);
  if (kind === 'image-url') return src ?? null;
  if (kind === 'image-ref') {
    try {
      return await signer(CAPTURES_BUCKET, src as string);
    } catch {
      return null;
    }
  }
  return null;
}
