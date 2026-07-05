import { describe, it, expect } from "vitest";
import { makeKeepAlive } from "./keepalive.js";

describe("makeKeepAlive", () => {
  it("POSTs keepalive_review_session and returns the new expiry in ms", async () => {
    const iso = "2026-07-05T20:00:00.000Z";
    let seen: { url: string; headers: Record<string, string>; body: unknown } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = {
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
      };
      return { ok: true, json: async () => iso } as unknown as Response;
    }) as unknown as typeof fetch;

    const keepAlive = makeKeepAlive({
      supabaseUrl: "https://s.co/",
      supabaseAnonKey: "anon",
      previewId: "p1",
      getAccessToken: () => "jwt",
      fetchImpl,
    });

    await expect(keepAlive()).resolves.toBe(Date.parse(iso));
    expect(seen!.url).toBe("https://s.co/rest/v1/rpc/keepalive_review_session");
    expect(seen!.headers.Authorization).toBe("Bearer jwt");
    expect(seen!.body).toEqual({ p_preview_id: "p1" });
  });

  it("returns null when the session lapsed (non-ok response)", async () => {
    const fetchImpl = (async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    const keepAlive = makeKeepAlive({
      supabaseUrl: "https://s.co",
      supabaseAnonKey: "a",
      previewId: "p",
      getAccessToken: () => "j",
      fetchImpl,
    });
    await expect(keepAlive()).resolves.toBeNull();
  });

  it("returns null on a network error (never throws)", async () => {
    const fetchImpl = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const keepAlive = makeKeepAlive({
      supabaseUrl: "https://s.co",
      supabaseAnonKey: "a",
      previewId: "p",
      getAccessToken: () => "j",
      fetchImpl,
    });
    await expect(keepAlive()).resolves.toBeNull();
  });
});
