/**
 * Shared client-side validation + naming for reviewer/member image uploads to
 * the private `captures` bucket (0027). The bucket ALSO enforces these caps
 * server-side (file_size_limit + allowed_mime_types); this is the UX-side gate
 * so a too-big / wrong-type file is rejected before an upload round-trip.
 *
 * It lives here — not in the overlay or the web app — so the overlay comment
 * composer, the overlay reply composer, the dashboard reply box, and the
 * dashboard prompt editor all share ONE source of truth for the caps, which
 * MUST stay in lockstep with the bucket definition (a drift would let the client
 * accept a file the server rejects, or vice versa).
 *
 * Pure + framework-free (no DOM `File`, no Supabase client): callers pass the
 * minimal `{ type, size }` shape a real `File` satisfies, so the logic is
 * node-testable from any runtime.
 */

/** Max object size — mirrors the 0027 `captures` bucket `file_size_limit`. */
export const MAX_CAPTURE_IMAGE_BYTES = 10 * 1024 * 1024;

/** Accepted MIME types — mirrors the 0027 bucket `allowed_mime_types`. */
export const CAPTURE_IMAGE_MIME = /^image\/(png|jpe?g|webp)$/i;

/**
 * Most images a single carrier (a comment's reference set, one reply, one
 * prompt) may hold. Bounds the UI AND the server-side RPC array cap so a client
 * can never stash an unbounded ref list that a member or the agent would later
 * sign.
 */
export const MAX_IMAGE_REFS_PER_CARRIER = 6;

/** The minimal file shape the validators read (a real `File` satisfies it). */
export interface CaptureImageFile {
  type: string;
  size: number;
}

/** True when a file is an accepted image within the size cap (client-side UX). */
export function isValidCaptureImage(file: CaptureImageFile): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (!CAPTURE_IMAGE_MIME.test(type)) return false;
  if (typeof file.size === "number" && file.size > MAX_CAPTURE_IMAGE_BYTES) {
    return false;
  }
  return true;
}

/**
 * The `captures` object extension for a MIME type (png | jpg | webp), matching
 * the overlay's `dataUrlToCapture` mapping (jpeg → jpg). Defaults to `png` for
 * an unrecognized type — callers should `isValidCaptureImage` first.
 */
export function extForCaptureMime(mime: string): "png" | "jpg" | "webp" {
  const m = (mime ?? "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/webp") return "webp";
  return "png";
}
