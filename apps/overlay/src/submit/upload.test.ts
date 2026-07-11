import { describe, it, expect } from "vitest";

import {
  CaptureUploader,
  dataUrlToCapture,
  type StoragePutter,
} from "./upload.js";

const PNG_DATAURL = "data:image/png;base64,aGVsbG8="; // "hello"
const pngBlob = () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" });

interface SeenPut {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function cfg(put: StoragePutter) {
  return {
    supabaseUrl: "https://proj.supabase.co/",
    supabaseAnonKey: "anon-key",
    previewId: "pv-123",
    getAccessToken: () => "session-jwt",
    makeId: () => "fixed-id",
    put,
  };
}

describe("dataUrlToCapture", () => {
  it("parses a png image data URL into bytes + type + ext", () => {
    const c = dataUrlToCapture(PNG_DATAURL);
    expect(c?.contentType).toBe("image/png");
    expect(c?.ext).toBe("png");
    expect(c?.bytes).toBeInstanceOf(Blob);
  });

  it("maps jpeg to a jpg extension", () => {
    expect(dataUrlToCapture("data:image/jpeg;base64,aGk=")?.ext).toBe("jpg");
  });

  it("rejects the JSON snapshot fallback (not a real image → stays inline)", () => {
    expect(dataUrlToCapture("data:application/json,%7B%7D")).toBeNull();
  });

  it("rejects a non-data string (e.g. an already-uploaded storage ref)", () => {
    expect(dataUrlToCapture("pv-123/x.png")).toBeNull();
  });
});

describe("CaptureUploader", () => {
  it("POSTs to the captures bucket with apikey + session bearer, returns the ref", async () => {
    let seen: SeenPut | undefined;
    const put: StoragePutter = async (url, body, headers) => {
      seen = { url, body, headers };
      return { ok: true, status: 200 };
    };
    const up = new CaptureUploader(cfg(put));
    const ref = await up.upload({
      bytes: pngBlob(),
      contentType: "image/png",
      ext: "png",
    });
    expect(ref).toBe("pv-123/fixed-id.png");
    expect(seen?.url).toBe(
      "https://proj.supabase.co/storage/v1/object/captures/pv-123/fixed-id.png",
    );
    expect(seen?.headers.apikey).toBe("anon-key");
    expect(seen?.headers.Authorization).toBe("Bearer session-jwt");
    expect(seen?.headers["content-type"]).toBe("image/png");
  });

  it("coerces a disallowed extension to png (matches the bucket allow-list)", async () => {
    let seenUrl = "";
    const put: StoragePutter = async (url) => {
      seenUrl = url;
      return { ok: true, status: 200 };
    };
    const up = new CaptureUploader(cfg(put));
    await up.upload({
      bytes: pngBlob(),
      contentType: "image/gif",
      ext: "gif",
    });
    expect(seenUrl).toContain("/captures/pv-123/fixed-id.png");
  });

  it("returns null when the upload is rejected (RLS / size / mime cap)", async () => {
    const up = new CaptureUploader(cfg(async () => ({ ok: false, status: 403 })));
    const ref = await up.upload({
      bytes: pngBlob(),
      contentType: "image/png",
      ext: "png",
    });
    expect(ref).toBeNull();
  });

  it("returns null (never throws) when the HTTP call throws", async () => {
    const up = new CaptureUploader(
      cfg(async () => {
        throw new Error("network down");
      }),
    );
    await expect(
      up.upload({ bytes: pngBlob(), contentType: "image/png", ext: "png" }),
    ).resolves.toBeNull();
  });

  it("uploadFont POSTs to the fonts bucket with the sniffed content-type (U9)", async () => {
    let seen: SeenPut | undefined;
    const put: StoragePutter = async (url, body, headers) => {
      seen = { url, body, headers };
      return { ok: true, status: 200 };
    };
    const up = new CaptureUploader(cfg(put));
    const ref = await up.uploadFont({
      bytes: new Blob([Uint8Array.from([0x77, 0x4f, 0x46, 0x32])], { type: "font/woff2" }),
      contentType: "font/woff2",
      ext: "woff2",
    });
    expect(ref).toBe("pv-123/fixed-id.woff2");
    expect(seen?.url).toBe(
      "https://proj.supabase.co/storage/v1/object/fonts/pv-123/fixed-id.woff2",
    );
    expect(seen?.headers["content-type"]).toBe("font/woff2");
  });

  it("uploadFont coerces a disallowed font extension to woff2", async () => {
    let seenUrl = "";
    const put: StoragePutter = async (url) => {
      seenUrl = url;
      return { ok: true, status: 200 };
    };
    const up = new CaptureUploader(cfg(put));
    await up.uploadFont({
      bytes: new Blob([Uint8Array.from([1])], { type: "font/woff2" }),
      contentType: "font/woff2",
      ext: "eot",
    });
    expect(seenUrl).toContain("/fonts/pv-123/fixed-id.woff2");
  });

  it("uploadDataUrl uploads a real image but skips the snapshot fallback", async () => {
    let calls = 0;
    const put: StoragePutter = async () => {
      calls++;
      return { ok: true, status: 200 };
    };
    const up = new CaptureUploader(cfg(put));
    expect(await up.uploadDataUrl(PNG_DATAURL)).toBe("pv-123/fixed-id.png");
    expect(await up.uploadDataUrl("data:application/json,%7B%7D")).toBeNull();
    expect(calls).toBe(1); // only the real image hit the network
  });

  it("throws when misconfigured (missing key or previewId)", () => {
    const noop: StoragePutter = async () => ({ ok: true, status: 200 });
    expect(
      () =>
        new CaptureUploader({
          supabaseUrl: "",
          supabaseAnonKey: "k",
          previewId: "p",
          getAccessToken: () => "t",
          put: noop,
        }),
    ).toThrow();
    expect(
      () =>
        new CaptureUploader({
          supabaseUrl: "u",
          supabaseAnonKey: "k",
          previewId: "",
          getAccessToken: () => "t",
          put: noop,
        }),
    ).toThrow();
  });
});
