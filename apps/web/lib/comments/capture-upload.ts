/**
 * Client-side upload of a member's image attachment to the private `captures`
 * bucket (0027), for the dashboard reply composer (comment-thread.tsx) and the
 * agent-prompt editor (agent-prompt.tsx).
 *
 * A workspace member authenticates as their real user (no review_sessions row),
 * so this relies on the member INSERT policy added in 0047. The object path is
 * `<previewId>/<uuid>.<ext>` — the SAME convention the overlay's CaptureUploader
 * (apps/overlay/src/submit/upload.ts) writes and every reader signs
 * (capture-ref.ts) — so a dashboard-uploaded image is indistinguishable from an
 * overlay-uploaded one downstream (display, MCP hand-off).
 *
 * Returns the storage REF (object path) to store in a reply/prompt `image_refs`
 * array, or `null` on validation failure / upload error. Mirroring the overlay
 * uploader, an image problem must NEVER be fatal to the surrounding save; this
 * never throws.
 *
 * The pure validation + naming (isValidCaptureImage / extForCaptureMime,
 * @supercomment/shared) is split from the `.upload()` call behind a minimal
 * injectable client so the path/mime/arg logic is node-testable without a real
 * Supabase client or a DOM (this repo's jsdom is broken — see vitest.config.ts).
 *
 * VERIFY IN REAL ENV: the live Storage upload + the 0047 member INSERT RLS need a
 * real member session + browser; only the request shape is unit-tested.
 */
import {
  CAPTURES_BUCKET,
  extForCaptureMime,
  isValidCaptureImage,
} from "@supercomment/shared";

/** The minimal Storage surface uploadCapture needs (a supabase-js client satisfies it). */
export interface CaptureUploadClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: Blob,
        options?: { contentType?: string; cacheControl?: string; upsert?: boolean },
      ): PromiseLike<{
        data: { path: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/** The minimal file shape uploadCapture reads (a real `File` satisfies it). */
export interface UploadableImage extends Blob {
  type: string;
  size: number;
}

export interface UploadCaptureOptions {
  /** Override the object-id generator (tests / determinism). */
  makeId?: () => string;
}

/**
 * Validate + upload one image; returns its `<previewId>/<uuid>.<ext>` ref, or
 * `null` when the file is not an accepted image or the upload fails. Never
 * throws — a failed image must not block the reply/prompt save.
 */
export async function uploadCapture(
  client: CaptureUploadClient,
  previewId: string,
  file: UploadableImage,
  options: UploadCaptureOptions = {},
): Promise<string | null> {
  if (!previewId) return null;
  if (!isValidCaptureImage({ type: file.type, size: file.size })) return null;
  const ext = extForCaptureMime(file.type);
  const path = `${previewId}/${(options.makeId ?? defaultId)()}.${ext}`;
  try {
    const { data, error } = await client.storage
      .from(CAPTURES_BUCKET)
      .upload(path, file, {
        contentType: file.type.toLowerCase(),
        cacheControl: "3600",
      });
    if (error || !data) return null;
    return data.path ?? path;
  } catch {
    return null;
  }
}

/** Default object id: crypto.randomUUID in the browser, Math.random fallback. */
function defaultId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* fall through */
  }
  return `cap-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
