import { describe, expect, it } from "vitest";

import {
  CAPTURE_IMAGE_MIME,
  MAX_CAPTURE_IMAGE_BYTES,
  MAX_IMAGE_REFS_PER_CARRIER,
  extForCaptureMime,
  isValidCaptureImage,
} from "./capture-image.js";

describe("isValidCaptureImage", () => {
  it("accepts png/jpeg/jpg/webp within the size cap", () => {
    for (const type of ["image/png", "image/jpeg", "image/jpg", "image/webp"]) {
      expect(isValidCaptureImage({ type, size: 1024 })).toBe(true);
    }
  });

  it("is case-insensitive on the MIME type", () => {
    expect(isValidCaptureImage({ type: "IMAGE/PNG", size: 1 })).toBe(true);
  });

  it("rejects non-image / disallowed types", () => {
    for (const type of ["image/gif", "image/svg+xml", "application/json", ""]) {
      expect(isValidCaptureImage({ type, size: 1 })).toBe(false);
    }
  });

  it("rejects a file over the 10 MiB bucket cap", () => {
    expect(
      isValidCaptureImage({ type: "image/png", size: MAX_CAPTURE_IMAGE_BYTES + 1 }),
    ).toBe(false);
    expect(
      isValidCaptureImage({ type: "image/png", size: MAX_CAPTURE_IMAGE_BYTES }),
    ).toBe(true);
  });

  it("cap mirrors the bucket definition (guards against silent drift)", () => {
    expect(MAX_CAPTURE_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(CAPTURE_IMAGE_MIME.test("image/webp")).toBe(true);
    expect(MAX_IMAGE_REFS_PER_CARRIER).toBeGreaterThan(0);
  });
});

describe("extForCaptureMime", () => {
  it("maps jpeg/jpg to jpg (matches the overlay uploader)", () => {
    expect(extForCaptureMime("image/jpeg")).toBe("jpg");
    expect(extForCaptureMime("image/jpg")).toBe("jpg");
  });

  it("maps png and webp to themselves", () => {
    expect(extForCaptureMime("image/png")).toBe("png");
    expect(extForCaptureMime("image/webp")).toBe("webp");
  });

  it("defaults an unknown type to png", () => {
    expect(extForCaptureMime("application/octet-stream")).toBe("png");
    expect(extForCaptureMime("")).toBe("png");
  });
});
