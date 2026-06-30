import { describe, expect, it, vi } from "vitest";

import { normalizeOrigin, runLogin } from "./login.js";
import type { ProjectBinding } from "../config/binding.js";
import type { ReceivedCreds } from "./callback-server.js";
import type { SupabaseQuery } from "./select.js";

// A JWT whose payload carries the REAL email. The displayed identity must come
// from this (decoded) token, not the spoofable `email` body field below.
const JWT =
  "h." +
  Buffer.from(JSON.stringify({ email: "dev@example.com", sub: "u1" })).toString(
    "base64url",
  ) +
  ".s";
const CREDS: ReceivedCreds = {
  token: JWT,
  refreshToken: "refresh-xyz",
  supabaseUrl: "https://ref.supabase.co",
  anonKey: "anon-key",
  email: "spoofed@evil.com", // body email — must be IGNORED in favor of the JWT
};

/** A fake client exposing exactly one project + review link (auto-selected). */
function oneProjectClient(): SupabaseQuery {
  const result = (data: unknown) => Promise.resolve({ data, error: null });
  return {
    from(table: string) {
      const rows =
        table === "projects"
          ? [{ id: "p1", name: "Super Project" }]
          : table === "previews"
            ? [{ id: "v1", slug: "rl-super", link_secret: "sk_x", project_id: "p1" }]
            : [];
      return {
        select: () => ({
          order: () => result(rows),
          eq: () => ({ order: () => result(rows) }),
        }),
        insert: () => ({ select: () => ({ single: async () => result(null) }) }),
      };
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

describe("normalizeOrigin", () => {
  it("strips trailing slashes", () => {
    expect(normalizeOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(normalizeOrigin("https://app.example.com")).toBe("https://app.example.com");
  });
});

describe("runLogin", () => {
  it("opens the right URL, writes a complete binding, and reports the target", async () => {
    let openedUrl = "";
    let written: ProjectBinding | undefined;
    const startServer = vi.fn(async (opts: { state: string; allowOrigin: string }) => {
      expect(opts.allowOrigin).toBe("http://localhost:3000");
      return {
        port: 54321,
        waitForCreds: async () => CREDS,
        close: () => undefined,
      };
    });

    const result = await runLogin({
      appUrl: "http://localhost:3000/",
      isTTY: false,
      genState: () => "fixed-state",
      startServer: startServer as never,
      openBrowser: async (url: string) => {
        openedUrl = url;
      },
      makeClient: async () => oneProjectClient(),
      writeBinding: async (b) => {
        written = b;
        return "/home/dev/.supercomment/binding.json";
      },
      log: () => undefined,
    });

    // The page is handed only a port + state — never an attacker-controllable URL.
    expect(openedUrl).toBe(
      "http://localhost:3000/cli-auth?port=54321&state=fixed-state",
    );
    expect(result.target.projectName).toBe("Super Project");
    // Identity comes from the JWT, NOT the spoofed body `email` (finding 2).
    expect(result.email).toBe("dev@example.com");

    expect(written).toEqual({
      supabaseUrl: "https://ref.supabase.co",
      token: JWT,
      previewId: "v1",
      projectId: "p1",
      anonKey: "anon-key",
      backendOrigin: "http://localhost:3000",
      refreshToken: "refresh-xyz",
      linkSecret: "sk_x",
    } satisfies ProjectBinding);
  });

  it("skips opening a browser with noBrowser but still resolves", async () => {
    const openBrowser = vi.fn(async () => undefined);
    await runLogin({
      appUrl: "http://localhost:3000",
      isTTY: false,
      noBrowser: true,
      genState: () => "s",
      startServer: (async () => ({
        port: 1,
        waitForCreds: async () => CREDS,
        close: () => undefined,
      })) as never,
      openBrowser,
      makeClient: async () => oneProjectClient(),
      writeBinding: async () => "/p",
      log: () => undefined,
    });
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
