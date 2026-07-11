/**
 * U9 — reviewer font uploads: sniff, guard, and instant preview.
 *
 * A reviewer can pick a local font file in the picker's Uploaded group. Before it
 * is ever stored we SNIFF its magic bytes to establish the TRUE format (browsers
 * report `application/octet-stream` for fonts) and to reject anything that is not
 * an inert font: only woff2 / woff / ttf / otf are accepted, so a renamed
 * `.svg` / `.html` / `.xml` (an XML document that could carry script) never
 * passes as a font. The sniffed content-type is what the client sends on upload,
 * which is what the 0051 bucket's `allowed_mime_types` gate then re-checks.
 *
 * The file previews INSTANTLY from its own ArrayBuffer via `FontFace(bytes)` in
 * the reviewer's OWN browser — the one place untrusted font bytes are parsed (the
 * same accepted risk class as the browser's image codecs parsing an attached
 * image). Other viewers never parse the bytes; the agent receives the file only
 * through the MCP signing gate. The actual Storage upload is deferred to comment
 * SAVE (so a discard never orphans an object), handled by the controller.
 *
 * Pure over its seams (a `FontFace` constructor is injected) so the sniffing and
 * the load state machine are unit-tested without a browser.
 */
import type { FontFaceLike } from "./load.js";
import type { FontRegistry } from "./registry.js";

/** The inert font formats we accept (matches the 0051 bucket mime allow-list). */
export type FontFormat = "woff2" | "woff" | "ttf" | "otf";

/** Hard cap (matches the bucket's 10 MiB server limit) + a soft warn threshold. */
export const FONT_MAX_BYTES = 10 * 1024 * 1024;
export const FONT_WARN_BYTES = 2 * 1024 * 1024;

/** At most this many uploaded fonts per change-set (client cap; read side re-caps). */
export const MAX_UPLOADED_FONTS_PER_CHANGESET = 2;

/** The rights-confirmation line shown on pick (the reviewer owns licensing). */
export const FONT_RIGHTS_NOTICE =
  "Only upload fonts you have the right to use. The file is shared with your team's agent.";

const CONTENT_TYPE: Record<FontFormat, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** The outcome of sniffing a candidate font's leading bytes. */
export interface SniffedFont {
  format: FontFormat;
  /** Canonical content-type to send on upload (what the bucket re-checks). */
  contentType: string;
  ext: FontFormat;
}

function u8(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/** The first four bytes equal the given byte tuple? */
function magic(b: Uint8Array, a: number, c: number, d: number, e: number): boolean {
  return b.length >= 4 && b[0] === a && b[1] === c && b[2] === d && b[3] === e;
}

/**
 * Identify a font by its magic bytes, or `null` when the bytes are not one of the
 * accepted inert font formats. Accepting ONLY known font signatures means every
 * non-font (svg/xml/html/image/archive/text) is rejected by default.
 */
export function sniffFont(bytes: ArrayBuffer | Uint8Array): SniffedFont | null {
  const b = u8(bytes);
  let format: FontFormat | null = null;
  if (magic(b, 0x77, 0x4f, 0x46, 0x32)) format = "woff2"; // "wOF2"
  else if (magic(b, 0x77, 0x4f, 0x46, 0x46)) format = "woff"; // "wOFF"
  else if (magic(b, 0x4f, 0x54, 0x54, 0x4f)) format = "otf"; // "OTTO" (CFF OpenType)
  else if (magic(b, 0x00, 0x01, 0x00, 0x00)) format = "ttf"; // TrueType outlines
  else if (magic(b, 0x74, 0x72, 0x75, 0x65)) format = "ttf"; // "true" (legacy TrueType)
  else if (magic(b, 0x74, 0x74, 0x63, 0x66)) format = "ttf"; // "ttcf" (TrueType collection)
  if (!format) return null;
  return { format, contentType: CONTENT_TYPE[format], ext: format };
}

/** Derive a display family name from a file name ("Inter-Bold.woff2" → "Inter Bold"). */
export function familyFromFileName(name: string | undefined): string {
  if (!name) return "Uploaded font";
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  return base || "Uploaded font";
}

/** The minimal File surface the picker reads (a real DOM `File` satisfies it). */
export interface UploadFileLike {
  name?: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FontUploadInput {
  bytes: ArrayBuffer;
  fileName?: string;
  fileSize: number;
}

/** A validated, ready-to-preview-and-upload font (the `ok` case of prepare). */
export interface PreparedFont {
  ok: true;
  format: FontFormat;
  contentType: string;
  ext: FontFormat;
  family: string;
  /** True above the soft threshold — WARN the reviewer, do not reject. */
  sizeWarning: boolean;
  bytes: ArrayBuffer;
}
export interface RejectedFont {
  ok: false;
  reason: "not-a-font" | "too-large";
}
export type FontUploadPrepared = PreparedFont | RejectedFont;

/**
 * Validate + classify a picked font file: reject anything over the hard cap or
 * that fails the magic-byte sniff; otherwise return the format, canonical
 * content-type, a suggested family name, and whether to warn on size.
 */
export function prepareFontUpload(input: FontUploadInput): FontUploadPrepared {
  if (input.fileSize > FONT_MAX_BYTES) return { ok: false, reason: "too-large" };
  const sniff = sniffFont(input.bytes);
  if (!sniff) return { ok: false, reason: "not-a-font" };
  return {
    ok: true,
    format: sniff.format,
    contentType: sniff.contentType,
    ext: sniff.ext,
    family: familyFromFileName(input.fileName),
    sizeWarning: input.fileSize > FONT_WARN_BYTES,
    bytes: input.bytes,
  };
}

/** Minimal doc surface the preview touches (add the face to the FontFaceSet). */
interface FontDocLite {
  fonts: { add(face: FontFaceLike): unknown };
}
export type UploadFontFaceCtor = new (
  family: string,
  source: BufferSource,
  descriptors?: { display?: string },
) => FontFaceLike;

/**
 * Preview an uploaded font by constructing a `FontFace` from its bytes, loading
 * it, and adding it to the document's FontFaceSet (tracked in the session
 * registry so it is removed on discard/exit). Returns the loaded face, or `null`
 * when the bytes fail to parse — the one place untrusted font bytes are parsed,
 * and only ever in the uploader's own browser. Never throws.
 */
export async function previewUploadedFont(
  deps: { doc: FontDocLite; FontFace: UploadFontFaceCtor; registry?: FontRegistry },
  family: string,
  bytes: BufferSource,
): Promise<FontFaceLike | null> {
  try {
    const face = new deps.FontFace(family, bytes, { display: "swap" });
    deps.registry?.track(deps.doc as never, face);
    deps.doc.fonts.add(face);
    await face.load();
    return face;
  } catch {
    return null;
  }
}
