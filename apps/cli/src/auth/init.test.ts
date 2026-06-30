import { describe, it, expect } from "vitest";

import { runInit } from "./init.js";
import type { ProjectBinding } from "../config/binding.js";
import type { SupabaseQuery } from "./select.js";

/** A fake client exposing one project + one review link, enough for resolveTarget. */
function fakeClient(): SupabaseQuery {
  const ok = (rows: unknown) => async () => ({ data: rows, error: null });
  const order = (rows: unknown) => ({ order: ok(rows), eq: () => ({ order: ok([]) }) });
  return {
    from(table: string) {
      if (table === "projects") {
        return {
          select: () => order([{ id: "p1", name: "Proj" }]),
          insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
        };
      }
      if (table === "previews") {
        return {
          select: () =>
            order([{ id: "pv1", slug: "s1", link_secret: null, project_id: "p1" }]),
          insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
        };
      }
      return {
        select: () => order([]),
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      };
    },
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseQuery;
}

describe("runInit", () => {
  it("PRESERVES the refresh token when re-pointing the binding (regression)", async () => {
    const existing: ProjectBinding = {
      supabaseUrl: "https://ref.supabase.co",
      token: "access-jwt",
      previewId: "old-preview",
      projectId: "old-project",
      anonKey: "anon",
      refreshToken: "R-keep",
      backendOrigin: "https://app.example.com",
    };
    let written: ProjectBinding | undefined;

    await runInit({
      loadBinding: async () => existing,
      makeClient: async () => fakeClient(),
      writeBinding: async (b) => {
        written = b;
        return "/tmp/binding.json";
      },
      isTTY: false,
      log: () => undefined,
    });

    expect(written?.refreshToken).toBe("R-keep"); // must survive the re-point
    expect(written?.previewId).toBe("pv1"); // and the project actually switched
    expect(written?.token).toBe("access-jwt");
    expect(written?.anonKey).toBe("anon");
  });
});
