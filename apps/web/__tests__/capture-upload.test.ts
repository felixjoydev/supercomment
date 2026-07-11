import { describe, expect, it, vi } from "vitest";

import { uploadCapture, type CaptureUploadClient } from "../lib/comments/capture-upload";

/**
 * Phase 0 — dashboard member image upload to the `captures` bucket. Node env,
 * pure logic + a mocked Supabase-Storage-shaped client (the real `.upload()`
 * round-trip + the 0047 member INSERT RLS are a real-env gate). Asserts the
 * path/mime/arg shape and the never-throws contract.
 */

function fakeClient(
  impl?: (
    path: string,
    file: Blob,
    opts?: { contentType?: string; cacheControl?: string },
  ) => { data: { path: string } | null; error: { message: string } | null },
): { client: CaptureUploadClient; upload: ReturnType<typeof vi.fn> } {
  const upload = vi.fn(
    (path: string, file: Blob, opts?: { contentType?: string; cacheControl?: string }) =>
      Promise.resolve(impl ? impl(path, file, opts) : { data: { path }, error: null }),
  );
  const client: CaptureUploadClient = {
    storage: { from: () => ({ upload }) },
  };
  return { client, upload };
}

const png = { type: "image/png", size: 2048 } as unknown as File;

describe("uploadCapture", () => {
  it("uploads to <previewId>/<uuid>.<ext> with the file's contentType", async () => {
    const { client, upload } = fakeClient();
    const ref = await uploadCapture(client, "prev-1", png, { makeId: () => "abc" });
    expect(ref).toBe("prev-1/abc.png");
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, file, opts] = upload.mock.calls[0]!;
    expect(path).toBe("prev-1/abc.png");
    expect(file).toBe(png);
    expect(opts).toMatchObject({ contentType: "image/png", cacheControl: "3600" });
  });

  it("maps jpeg to a .jpg extension (matches the overlay uploader)", async () => {
    const { client } = fakeClient();
    const jpg = { type: "image/jpeg", size: 10 } as unknown as File;
    expect(await uploadCapture(client, "p", jpg, { makeId: () => "id" })).toBe("p/id.jpg");
  });

  it("returns null (no upload attempted) for a disallowed type", async () => {
    const { client, upload } = fakeClient();
    const gif = { type: "image/gif", size: 10 } as unknown as File;
    expect(await uploadCapture(client, "p", gif)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns null (no upload attempted) for an over-cap file", async () => {
    const { client, upload } = fakeClient();
    const big = { type: "image/png", size: 11 * 1024 * 1024 } as unknown as File;
    expect(await uploadCapture(client, "p", big)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns null when previewId is missing", async () => {
    const { client, upload } = fakeClient();
    expect(await uploadCapture(client, "", png)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns null on a Storage error, never throwing", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "denied" } }));
    expect(await uploadCapture(client, "p", png)).toBeNull();
  });

  it("returns null when the upload throws, never propagating", async () => {
    const client: CaptureUploadClient = {
      storage: {
        from: () => ({
          upload: () => Promise.reject(new Error("network")) as never,
        }),
      },
    };
    await expect(uploadCapture(client, "p", png)).resolves.toBeNull();
  });

  it("prefers the returned data.path over the constructed path", async () => {
    const { client } = fakeClient((path) => ({ data: { path: `srv/${path}` }, error: null }));
    expect(await uploadCapture(client, "p", png, { makeId: () => "x" })).toBe("srv/p/x.png");
  });
});
