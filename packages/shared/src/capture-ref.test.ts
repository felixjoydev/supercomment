import { describe, it, expect, vi } from "vitest";

import {
  CAPTURES_BUCKET,
  classifyCaptureRef,
  resolveCaptureSrc,
  type CaptureSigner,
} from "./capture-ref.js";

describe("classifyCaptureRef", () => {
  it("classifies an inline image data URL as directly renderable", () => {
    expect(classifyCaptureRef("data:image/png;base64,AAAA")).toBe("image-url");
  });

  it("classifies the DOM-snapshot fallback as a snapshot indicator", () => {
    expect(classifyCaptureRef("data:application/json,%7B%7D")).toBe("snapshot");
  });

  it("does NOT render a guest-supplied absolute URL directly — treats it as a bucket path (M5)", () => {
    // `context` is guest-controlled; an attacker http(s) URL must never become an
    // <img src> pointing at their origin. It is classified as a path to be signed
    // (which fails for a non-path in reality → null), not directly renderable.
    expect(classifyCaptureRef("https://attacker.example/p.png?u=v")).toBe("image-ref");
    expect(
      classifyCaptureRef("https://x.supabase.co/storage/v1/object/sign/captures/a.png"),
    ).toBe("image-ref");
  });

  it("classifies a bare bucket object path as a ref needing signing", () => {
    expect(
      classifyCaptureRef("3fb218bf-0000-4000-8000-000000000000/cap-1.png"),
    ).toBe("image-ref");
  });

  it("classifies missing/empty as none", () => {
    expect(classifyCaptureRef(undefined)).toBe("none");
    expect(classifyCaptureRef("")).toBe("none");
  });
});

describe("resolveCaptureSrc", () => {
  it("signs a private-bucket ref via the captures bucket", async () => {
    const signer = vi.fn<CaptureSigner>(
      async (_bucket, path) => `https://signed/${path}?token=abc`,
    );
    const ref = "3fb218bf-0000-4000-8000-000000000000/cap-1.png";

    const url = await resolveCaptureSrc(ref, signer);

    expect(signer).toHaveBeenCalledWith(CAPTURES_BUCKET, ref);
    expect(url).toBe(`https://signed/${ref}?token=abc`);
  });

  it("returns an inline image URL unchanged without signing", async () => {
    const signer = vi.fn<CaptureSigner>(async () => "should-not-be-used");
    const url = await resolveCaptureSrc("data:image/png;base64,AAAA", signer);
    expect(url).toBe("data:image/png;base64,AAAA");
    expect(signer).not.toHaveBeenCalled();
  });

  it("returns null for the snapshot fallback (not a resolvable image)", async () => {
    const signer = vi.fn<CaptureSigner>(async () => "should-not-be-used");
    expect(await resolveCaptureSrc("data:application/json,%7B%7D", signer)).toBeNull();
    expect(signer).not.toHaveBeenCalled();
  });

  it("returns null when signing fails (missing object / no permission)", async () => {
    const signer: CaptureSigner = async () => null;
    expect(await resolveCaptureSrc("preview/cap.png", signer)).toBeNull();
  });

  it("never throws when the signer rejects", async () => {
    const signer: CaptureSigner = async () => {
      throw new Error("boom");
    };
    await expect(resolveCaptureSrc("preview/cap.png", signer)).resolves.toBeNull();
  });

  it("routes a guest-supplied absolute URL through the signer, never returning it raw (M5)", async () => {
    // The signer treats it as a bucket path; a real Storage sign of a bogus path
    // returns null, so the attacker origin is never fetched. This proves
    // resolveCaptureSrc does NOT short-circuit and hand back the raw URL.
    const signer = vi.fn<CaptureSigner>(async () => null);
    const url = await resolveCaptureSrc("https://attacker.example/p.png", signer);
    expect(signer).toHaveBeenCalledWith(CAPTURES_BUCKET, "https://attacker.example/p.png");
    expect(url).toBeNull();
  });
});
