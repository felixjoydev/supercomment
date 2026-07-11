import { describe, it, expect, vi } from "vitest";

import {
  sniffFont,
  familyFromFileName,
  prepareFontUpload,
  previewUploadedFont,
  FONT_MAX_BYTES,
  FONT_WARN_BYTES,
  type UploadFontFaceCtor,
} from "./upload.js";
import { FontRegistry } from "./registry.js";

/** Build an ArrayBuffer whose leading bytes are `head`, padded to `size`. */
function bytesWith(head: number[], size = head.length): ArrayBuffer {
  const b = new Uint8Array(size);
  b.set(head);
  return b.buffer;
}

const WOFF2 = [0x77, 0x4f, 0x46, 0x32];
const WOFF = [0x77, 0x4f, 0x46, 0x46];
const OTTO = [0x4f, 0x54, 0x54, 0x4f];
const TTF = [0x00, 0x01, 0x00, 0x00];
const SVG = [0x3c, 0x3f, 0x78, 0x6d]; // "<?xm" (XML/SVG)
const PNG = [0x89, 0x50, 0x4e, 0x47];

describe("sniffFont (U9)", () => {
  it("identifies the inert font formats by magic bytes", () => {
    expect(sniffFont(bytesWith(WOFF2))).toMatchObject({ format: "woff2", contentType: "font/woff2" });
    expect(sniffFont(bytesWith(WOFF))).toMatchObject({ format: "woff", contentType: "font/woff" });
    expect(sniffFont(bytesWith(OTTO))).toMatchObject({ format: "otf", contentType: "font/otf" });
    expect(sniffFont(bytesWith(TTF))).toMatchObject({ format: "ttf", contentType: "font/ttf" });
  });

  it("rejects non-font bytes (svg/xml, png, empty)", () => {
    expect(sniffFont(bytesWith(SVG))).toBeNull();
    expect(sniffFont(bytesWith(PNG))).toBeNull();
    expect(sniffFont(new Uint8Array([]))).toBeNull();
  });

  it("accepts a Uint8Array as well as an ArrayBuffer", () => {
    expect(sniffFont(new Uint8Array(WOFF2))?.format).toBe("woff2");
  });
});

describe("familyFromFileName (U9)", () => {
  it("strips the extension and normalizes separators", () => {
    expect(familyFromFileName("Inter-Bold.woff2")).toBe("Inter Bold");
    expect(familyFromFileName("My_Custom_Font.ttf")).toBe("My Custom Font");
    expect(familyFromFileName(undefined)).toBe("Uploaded font");
  });
});

describe("prepareFontUpload (U9)", () => {
  it("accepts a valid font and suggests a family, warning above the soft cap", () => {
    const out = prepareFontUpload({
      bytes: bytesWith(WOFF2, 3 * 1024 * 1024),
      fileName: "Satoshi-Regular.woff2",
      fileSize: 3 * 1024 * 1024,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.format).toBe("woff2");
      expect(out.contentType).toBe("font/woff2");
      expect(out.family).toBe("Satoshi Regular");
      expect(out.sizeWarning).toBe(true); // > 2 MiB
    }
  });

  it("does not warn for a small valid font", () => {
    const out = prepareFontUpload({
      bytes: bytesWith(WOFF2),
      fileName: "x.woff2",
      fileSize: FONT_WARN_BYTES - 1,
    });
    expect(out.ok && out.sizeWarning).toBe(false);
  });

  it("rejects a renamed non-font (svg) via the magic-byte sniff", () => {
    const out = prepareFontUpload({ bytes: bytesWith(SVG), fileName: "evil.woff2", fileSize: 100 });
    expect(out).toEqual({ ok: false, reason: "not-a-font" });
  });

  it("rejects a file over the hard 10 MiB cap before sniffing", () => {
    const out = prepareFontUpload({ bytes: bytesWith(WOFF2), fileName: "big.woff2", fileSize: FONT_MAX_BYTES + 1 });
    expect(out).toEqual({ ok: false, reason: "too-large" });
  });
});

describe("previewUploadedFont (U9)", () => {
  function fontFaceClass(behavior: "resolve" | "reject") {
    const added: unknown[] = [];
    const cls = class {
      family: string;
      constructor(family: string, _src: BufferSource) {
        this.family = family;
      }
      load() {
        return behavior === "resolve"
          ? Promise.resolve(this)
          : Promise.reject(new Error("bad font bytes"));
      }
    } as unknown as UploadFontFaceCtor;
    return { cls, added };
  }

  it("constructs a FontFace from bytes, adds it, tracks it, and resolves", async () => {
    const { cls } = fontFaceClass("resolve");
    const registry = new FontRegistry();
    const add = vi.fn();
    const doc = { fonts: { add } };
    const face = await previewUploadedFont(
      { doc, FontFace: cls, registry },
      "Satoshi",
      new Uint8Array(WOFF2),
    );
    expect(face).not.toBeNull();
    expect(add).toHaveBeenCalledOnce();
    expect(registry.size(doc as never)).toBe(1);
  });

  it("returns null (never throws) when the bytes fail to parse", async () => {
    const { cls } = fontFaceClass("reject");
    const face = await previewUploadedFont(
      { doc: { fonts: { add() {} } }, FontFace: cls },
      "Broken",
      new Uint8Array(WOFF2),
    );
    expect(face).toBeNull();
  });
});
