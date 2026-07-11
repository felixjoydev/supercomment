/**
 * U7 (read) — resolving a comment's captured "before" artifact / screenshot for
 * display in the dashboard.
 *
 * The classification + resolution logic (and the M5 SSRF guard) now lives in
 * `@supercomment/shared` (U11) so `apps/cli` — which cannot import `apps/web` —
 * can reuse the exact same, security-bearing implementation instead of
 * re-deriving it. This module just re-exports the shared copy so existing web
 * imports (`@/lib/comments/capture-ref`) keep working unchanged.
 */

export {
  CAPTURES_BUCKET,
  classifyCaptureRef,
  resolveCaptureSrc,
  type CaptureKind,
  type CaptureSigner,
} from '@supercomment/shared';
