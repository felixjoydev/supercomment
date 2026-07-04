import { describe, it, expect } from "vitest";
import { makeSetGuestEmail } from "./email.js";

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

describe("makeSetGuestEmail", () => {
  it("POSTs set_guest_email with the preview id, email, and session bearer", async () => {
    const calls: Recorded[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
      });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;

    const setEmail = makeSetGuestEmail({
      supabaseUrl: "https://s.co/",
      supabaseAnonKey: "anon",
      previewId: "p1",
      getAccessToken: () => "jwt",
      fetchImpl,
    });

    await expect(setEmail("client@acme.com")).resolves.toBe(true);
    expect(calls[0]!.url).toBe("https://s.co/rest/v1/rpc/set_guest_email");
    expect(calls[0]!.headers.Authorization).toBe("Bearer jwt");
    expect(calls[0]!.headers.apikey).toBe("anon");
    expect(calls[0]!.body).toEqual({ p_preview_id: "p1", p_email: "client@acme.com" });
  });

  it("resolves false and never throws on a network error (best-effort)", async () => {
    const fetchImpl = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const setEmail = makeSetGuestEmail({
      supabaseUrl: "https://s.co",
      supabaseAnonKey: "a",
      previewId: "p",
      getAccessToken: () => "j",
      fetchImpl,
    });
    await expect(setEmail("x@y.com")).resolves.toBe(false);
  });

  it("resolves false on a non-ok response", async () => {
    const fetchImpl = (async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    const setEmail = makeSetGuestEmail({
      supabaseUrl: "https://s.co",
      supabaseAnonKey: "a",
      previewId: "p",
      getAccessToken: () => "j",
      fetchImpl,
    });
    await expect(setEmail("x@y.com")).resolves.toBe(false);
  });
});
