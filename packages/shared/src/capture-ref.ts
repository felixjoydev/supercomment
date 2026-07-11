/**
 * U11 (shared) — resolving a comment's captured "before" artifact / screenshot
 * for display, shared by every consumer that needs to render a stored capture
 * value (the web dashboard today; the CLI hand-off view later).
 *
 * A real raster is stored in the PRIVATE `captures` Storage bucket as an object
 * PATH (`<previewId>/<uuid>.<ext>`), not a URL. To show it, the caller signs the
 * path into a short-lived URL with its own session (0027 RLS SELECT via
 * is_preview_workspace_member). Inline `image/*` data URLs and the DOM-snapshot
 * fallback (`data:application/json,…`) need no resolution.
 *
 * Pure + framework-free (no Supabase client dependency — the signer is
 * injected) so the classification + resolution logic is node-testable and
 * usable from any runtime, including `apps/cli` which cannot import
 * `apps/web`.
 */

/** The private bucket created in migration 0027 (mirrors the overlay upload). */
export const CAPTURES_BUCKET = 'captures';

/** The private font-upload bucket created in migration 0051 (U9). */
export const FONTS_BUCKET = 'fonts';

/** A uuid, for the `<previewId>/<uuid>.<ext>` object-path convention. */
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/** Escape regex metacharacters so a value can be embedded in a `RegExp` literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Is `ref` a font object PATH that is PINNED to this comment's preview (U9)? True
 * only for exactly `<previewId>/<uuid>.<ext>` where `previewId` is the caller's
 * SERVER-RESOLVED preview id (never a value read from the guest-controlled
 * change-set) and `<ext>` is an inert font format. This is the read-side gate that
 * stops a malicious `font.fileRef` from pointing the agent's signer at another
 * preview's folder (or an arbitrary storage path): a ref that does not match the
 * pinned pattern is never signed.
 */
export function isPinnedFontRef(
  ref: string | null | undefined,
  previewId: string | null | undefined,
): boolean {
  if (!ref || !previewId) return false;
  const re = new RegExp(`^${escapeRegExp(previewId)}/${UUID_RE}\\.(woff2|woff|ttf|otf)$`);
  return re.test(ref);
}

/**
 * Resolve an uploaded-font `font.fileRef` to a short-lived signed URL, or `null`
 * when the ref is not pinned to `previewId` or signing failed. The caller passes
 * the SERVER-RESOLVED preview id; the member-or-confirmed-guest trust gate is the
 * caller's responsibility (this only does the pin check + signing). Never throws.
 */
export async function resolveFontSrc(
  ref: string | null | undefined,
  previewId: string | null | undefined,
  signer: CaptureSigner,
): Promise<string | null> {
  if (!isPinnedFontRef(ref, previewId)) return null;
  try {
    return await signer(FONTS_BUCKET, ref as string);
  } catch {
    return null;
  }
}

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
