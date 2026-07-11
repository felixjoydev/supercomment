/**
 * U7 — direct-to-Storage capture upload.
 *
 * The overlay uploads a captured raster (or a reviewer's reference image)
 * straight to the Supabase Storage `captures` bucket via the Storage REST API —
 * the SAME two headers as the PostgREST write path (`apikey` + the reviewer's
 * anon SESSION JWT), so the 0027 RLS authorizes it via the review_sessions row.
 * Bytes never traverse a Next function (avoids the 4.5 MB Vercel body cap). The
 * object path is `<previewId>/<uuid>.<ext>`; RLS scopes by the leading previewId.
 *
 * Returns the storage REF (the object path) to store in `context.screenshot` /
 * `context.referenceImages`; returns `null` on ANY failure so a capture/upload
 * problem can NEVER block comment submission (best-effort, never throws).
 *
 * VERIFY IN REAL ENV: the live Storage POST — auth, the 0027 RLS check, and the
 * bucket's server-side size/mime caps — needs a real session JWT + browser. Only
 * the request shape + ref/data-url logic is covered by tests.
 */
/** The private bucket created in migration 0027. */
export const CAPTURES_BUCKET = "captures";

/** The private font-upload bucket created in migration 0051 (U9). */
export const FONTS_BUCKET = "fonts";

/** Image extensions the `captures` bucket accepts (mirrors allowed_mime_types). */
const ALLOWED_EXT = new Set(["png", "jpg", "webp"]);

/** Font extensions the `fonts` bucket accepts (mirrors 0051 allowed_mime_types). */
const ALLOWED_FONT_EXT = new Set(["woff2", "woff", "ttf", "otf"]);

/** A binary capture ready to upload: a Blob + its MIME type + file extension. */
export interface CaptureBlob {
  /** The image bytes as a Blob — a valid fetch body (browser + node 18 global). */
  bytes: Blob;
  contentType: string;
  ext: string;
}

/** Injectable low-level HTTP PUT/POST (tests mock it; prod uses fetch). */
export type StoragePutter = (
  url: string,
  body: Blob,
  headers: Record<string, string>,
) => Promise<{ ok: boolean; status: number; statusText?: string }>;

export interface CaptureUploaderConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** The preview this session is scoped to (RLS re-checks it via the JWT). */
  previewId: string;
  /** Returns the current (possibly just-refreshed) anon session access token. */
  getAccessToken: () => string | Promise<string>;
  /** Override the HTTP call (tests). Defaults to a fetch-based Storage POST. */
  put?: StoragePutter;
  /** Override the object-id generator (tests / determinism). */
  makeId?: () => string;
}

/**
 * Parse a `data:image/*;base64,...` URL into an uploadable {@link CaptureBlob}.
 * Returns `null` for anything that is NOT a real supported image — notably the
 * `data:application/json,...` snapshot fallback (that stays inline in the context
 * as before; only real rasters are uploaded out-of-band).
 */
export function dataUrlToCapture(dataUrl: string): CaptureBlob | null {
  const m = /^data:(image\/(png|jpeg|jpg|webp));base64,(.*)$/i.exec(dataUrl);
  if (!m || !m[1] || !m[2]) return null;
  const contentType = m[1].toLowerCase();
  const rawExt = m[2].toLowerCase();
  const ext = rawExt === "jpeg" ? "jpg" : rawExt;
  const bytes = base64ToBytes(m[3] ?? "");
  if (!bytes) return null;
  // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
  // Uint8Array<ArrayBufferLike> vs ArrayBuffer strictness in the DOM lib.
  return {
    bytes: new Blob([bytes as BlobPart], { type: contentType }),
    contentType,
    ext,
  };
}

/** Decode base64 to bytes; null if the environment lacks `atob` or input is bad. */
function base64ToBytes(b64: string): Uint8Array | null {
  try {
    if (typeof atob !== "function" || !b64) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Coerce an extension to the bucket's allow-list; defaults to png. */
function safeExt(ext: string): string {
  const e = ext.toLowerCase();
  return ALLOWED_EXT.has(e) ? e : "png";
}

/** Coerce a font extension to the fonts bucket's allow-list; defaults to woff2. */
function safeFontExt(ext: string): string {
  const e = ext.toLowerCase();
  return ALLOWED_FONT_EXT.has(e) ? e : "woff2";
}

/**
 * Uploads captures to the `captures` bucket, returning storage refs (object
 * paths). Constructed once per active session (index.ts wires the same
 * url/key/previewId/getAccessToken as {@link SessionCommentSubmitter}).
 */
export class CaptureUploader {
  private readonly base: string;
  private readonly anonKey: string;
  private readonly previewId: string;
  private readonly getAccessToken: () => string | Promise<string>;
  private readonly put: StoragePutter;
  private readonly makeId: () => string;

  constructor(config: CaptureUploaderConfig) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("CaptureUploader requires a supabaseUrl and anon key.");
    }
    if (!config.previewId) {
      throw new Error("CaptureUploader requires a previewId.");
    }
    this.base = config.supabaseUrl.replace(/\/+$/, "");
    this.anonKey = config.supabaseAnonKey;
    this.previewId = config.previewId;
    this.getAccessToken = config.getAccessToken;
    this.put = config.put ?? makeFetchPutter();
    this.makeId = config.makeId ?? defaultId;
  }

  /**
   * Upload one capture; returns its storage ref (`<previewId>/<id>.<ext>`) or
   * `null` on any failure. Never throws — a failed upload must not block submit.
   */
  async upload(capture: CaptureBlob): Promise<string | null> {
    return this.uploadTo(CAPTURES_BUCKET, capture.bytes, capture.contentType, safeExt(capture.ext));
  }

  /**
   * Upload one FONT file (U9) to the `fonts` bucket, returning its storage ref
   * or `null` on any failure. The content-type is the caller's magic-byte-sniffed
   * type (never the browser's octet-stream), which the 0051 bucket re-checks.
   */
  async uploadFont(font: CaptureBlob): Promise<string | null> {
    return this.uploadTo(FONTS_BUCKET, font.bytes, font.contentType, safeFontExt(font.ext));
  }

  /** Shared POST to a private bucket; returns the object path or null. Never throws. */
  private async uploadTo(
    bucket: string,
    bytes: Blob,
    contentType: string,
    ext: string,
  ): Promise<string | null> {
    try {
      const path = `${this.previewId}/${this.makeId()}.${ext}`;
      const url = `${this.base}/storage/v1/object/${bucket}/${path}`;
      const token = await this.getAccessToken();
      const res = await this.put(url, bytes, {
        apikey: this.anonKey,
        Authorization: `Bearer ${token}`,
        "content-type": contentType,
        "cache-control": "max-age=3600",
      });
      return res.ok ? path : null;
    } catch {
      return null;
    }
  }

  /**
   * Convenience: upload a `data:image/*` URL (e.g. the rasterizer's output).
   * Returns the ref, or `null` when the input is not a real image (the snapshot
   * fallback stays inline) or the upload fails.
   */
  async uploadDataUrl(dataUrl: string): Promise<string | null> {
    const capture = dataUrlToCapture(dataUrl);
    return capture ? this.upload(capture) : null;
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

/** VERIFY IN REAL ENV: the live Storage POST with the reviewer's session JWT. */
function makeFetchPutter(): StoragePutter {
  return async (url, body, headers) => {
    const res = await fetch(url, { method: "POST", headers, body });
    return { ok: res.ok, status: res.status, statusText: res.statusText };
  };
}
