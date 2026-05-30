import { describe, expect, it } from "vitest";
import {
  bindingFromEnv,
  BindingNotFoundError,
  loadProjectBinding,
  resolveBindingPath,
} from "./binding.js";

describe("resolveBindingPath", () => {
  it("prefers SUPERCOMMENT_BINDING_PATH when set", () => {
    const path = resolveBindingPath(
      { SUPERCOMMENT_BINDING_PATH: "/tmp/custom/binding.json" },
      "/home/dev",
    );
    expect(path).toBe("/tmp/custom/binding.json");
  });

  it("falls back to ~/.supercomment/binding.json", () => {
    const path = resolveBindingPath({}, "/home/dev");
    expect(path).toBe("/home/dev/.supercomment/binding.json");
  });
});

describe("bindingFromEnv", () => {
  it("builds a binding when all SUPERCOMMENT_* vars are present", () => {
    const b = bindingFromEnv({
      SUPERCOMMENT_SUPABASE_URL: "https://ref.supabase.co",
      SUPERCOMMENT_TOKEN: "tok",
      SUPERCOMMENT_PREVIEW_ID: "11111111-1111-1111-1111-111111111111",
      SUPERCOMMENT_PROJECT_ID: "proj-1",
    });
    expect(b).toEqual({
      supabaseUrl: "https://ref.supabase.co",
      token: "tok",
      previewId: "11111111-1111-1111-1111-111111111111",
      projectId: "proj-1",
    });
  });

  it("returns undefined when a required var is missing", () => {
    expect(
      bindingFromEnv({
        SUPERCOMMENT_SUPABASE_URL: "https://ref.supabase.co",
        SUPERCOMMENT_TOKEN: "tok",
        // no preview id
      }),
    ).toBeUndefined();
  });
});

describe("loadProjectBinding", () => {
  it("uses env vars when present (no file read)", async () => {
    const b = await loadProjectBinding({
      env: {
        SUPERCOMMENT_SUPABASE_URL: "https://ref.supabase.co",
        SUPERCOMMENT_TOKEN: "tok",
        SUPERCOMMENT_PREVIEW_ID: "11111111-1111-1111-1111-111111111111",
      },
      readTextFile: async () => {
        throw new Error("should not read file when env is set");
      },
    });
    expect(b.previewId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("reads and parses the binding file", async () => {
    const payload = JSON.stringify({
      supabaseUrl: "https://ref.supabase.co",
      token: "tok",
      previewId: "22222222-2222-2222-2222-222222222222",
      projectId: "p",
    });
    const b = await loadProjectBinding({
      env: {},
      home: "/home/dev",
      readTextFile: async (path) => {
        expect(path).toBe("/home/dev/.supercomment/binding.json");
        return payload;
      },
    });
    expect(b.token).toBe("tok");
    expect(b.previewId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("throws BindingNotFoundError when the file is missing", async () => {
    await expect(
      loadProjectBinding({
        env: {},
        home: "/home/dev",
        readTextFile: async () => {
          throw new Error("ENOENT");
        },
      }),
    ).rejects.toBeInstanceOf(BindingNotFoundError);
  });

  it("throws BindingNotFoundError on malformed JSON", async () => {
    await expect(
      loadProjectBinding({
        env: {},
        home: "/home/dev",
        readTextFile: async () => "{not json",
      }),
    ).rejects.toBeInstanceOf(BindingNotFoundError);
  });

  it("throws BindingNotFoundError when required fields are missing", async () => {
    await expect(
      loadProjectBinding({
        env: {},
        home: "/home/dev",
        readTextFile: async () =>
          JSON.stringify({ supabaseUrl: "https://x", token: "t" }),
      }),
    ).rejects.toBeInstanceOf(BindingNotFoundError);
  });
});
