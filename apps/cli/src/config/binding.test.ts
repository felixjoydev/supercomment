import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  bindingFromEnv,
  clearProjectBinding,
  loadProjectBinding,
  resolveBindingPath,
  writeProjectBinding,
  type ProjectBinding,
} from "./binding.js";

const SAMPLE: ProjectBinding = {
  supabaseUrl: "https://ref.supabase.co",
  token: "dev-scoped-token",
  previewId: "33333333-3333-3333-3333-333333333333",
  projectId: "proj-9",
};

describe("writeProjectBinding -> loadProjectBinding round trip (fakes)", () => {
  it("round-trips the exact shape through injected fs + the canonical loader", async () => {
    const files = new Map<string, string>();
    const fs = {
      mkdir: async () => undefined,
      writeFile: async (p: string, data: string) => {
        files.set(p, data);
      },
      rename: async (from: string, to: string) => {
        const data = files.get(from);
        if (data === undefined) throw new Error(`missing temp ${from}`);
        files.set(to, data);
        files.delete(from);
      },
    };
    const env = {};
    const home = "/home/dev";

    const writtenPath = await writeProjectBinding(SAMPLE, { env, home, fs });
    expect(writtenPath).toBe("/home/dev/.supercomment/binding.json");

    const loaded = await loadProjectBinding({
      env,
      home,
      readTextFile: async (p) => {
        const data = files.get(p);
        if (data === undefined) throw new Error("ENOENT");
        return data;
      },
    });
    expect(loaded).toEqual(SAMPLE);
  });

  it("omits projectId when not provided", async () => {
    const files = new Map<string, string>();
    const fs = {
      mkdir: async () => undefined,
      writeFile: async (p: string, data: string) => {
        files.set(p, data);
      },
      rename: async (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
    };
    const { projectId: _omit, ...noProject } = SAMPLE;
    await writeProjectBinding(noProject, { env: {}, home: "/h", fs });
    const written = files.get("/h/.supercomment/binding.json")!;
    expect(JSON.parse(written)).toEqual(noProject);
    expect(JSON.parse(written)).not.toHaveProperty("projectId");
  });

  it("refuses to write an invalid binding", async () => {
    await expect(
      writeProjectBinding(
        { supabaseUrl: "", token: "t", previewId: "p" } as ProjectBinding,
        { env: {}, home: "/h" },
      ),
    ).rejects.toThrow(/invalid project binding/i);
  });

  it("env override path is honored by writer and loader", async () => {
    const files = new Map<string, string>();
    const fs = {
      mkdir: async () => undefined,
      writeFile: async (p: string, data: string) => {
        files.set(p, data);
      },
      rename: async (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
    };
    const env = { SUPERCOMMENT_BINDING_PATH: "/custom/here/binding.json" };
    const writtenPath = await writeProjectBinding(SAMPLE, { env, fs });
    expect(writtenPath).toBe("/custom/here/binding.json");
    const loaded = await loadProjectBinding({
      env,
      readTextFile: async (p) =>
        files.get(p) ?? Promise.reject(new Error("ENOENT")),
    });
    expect(loaded).toEqual(SAMPLE);
  });
});

describe("writeProjectBinding -> loadProjectBinding round trip (real fs)", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "supercomment-binding-"));
    env = { SUPERCOMMENT_BINDING_PATH: join(dir, "nested", "binding.json") };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("mkdir -p's the dir, writes 0600, and round-trips off the real disk", async () => {
    const path = await writeProjectBinding(SAMPLE, { env });
    expect(path).toBe(env.SUPERCOMMENT_BINDING_PATH);

    const loaded = await loadProjectBinding({ env });
    expect(loaded).toEqual(SAMPLE);

    // Best-effort 0600 check (skipped on platforms that don't honor mode bits).
    const st = await stat(path);
    const mode = st.mode & 0o777;
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }

    // No temp file left behind after the atomic rename.
    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toEqual(SAMPLE);
  });

  it("clearProjectBinding removes the file and is idempotent", async () => {
    await writeProjectBinding(SAMPLE, { env });
    const cleared = await clearProjectBinding({ env });
    expect(cleared).toBe(env.SUPERCOMMENT_BINDING_PATH);
    await expect(loadProjectBinding({ env })).rejects.toThrow();
    // Second clear on a missing file must not throw.
    await expect(clearProjectBinding({ env })).resolves.toBe(
      env.SUPERCOMMENT_BINDING_PATH,
    );
  });
});

describe("binding extras (anonKey / linkSecret / backendOrigin)", () => {
  const makeFakeFs = (files: Map<string, string>) => ({
    mkdir: async () => undefined,
    writeFile: async (p: string, data: string) => {
      files.set(p, data);
    },
    rename: async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
  });

  it("round-trips anonKey, linkSecret, and backendOrigin", async () => {
    const files = new Map<string, string>();
    const fs = makeFakeFs(files);
    const full: ProjectBinding = {
      ...SAMPLE,
      anonKey: "anon-publishable-key",
      refreshToken: "refresh-token-value",
      linkSecret: "sk_guest_secret",
      backendOrigin: "https://app.supercomment.dev",
    };
    await writeProjectBinding(full, { env: {}, home: "/h", fs });
    const loaded = await loadProjectBinding({
      env: {},
      home: "/h",
      readTextFile: async (p) => files.get(p) ?? Promise.reject("ENOENT"),
    });
    expect(loaded).toEqual(full);
  });

  it("omits each extra when not provided (no null/undefined leakage)", async () => {
    const files = new Map<string, string>();
    const fs = makeFakeFs(files);
    await writeProjectBinding(SAMPLE, { env: {}, home: "/h", fs });
    const written = JSON.parse(files.get("/h/.supercomment/binding.json")!);
    expect(written).not.toHaveProperty("anonKey");
    expect(written).not.toHaveProperty("refreshToken");
    expect(written).not.toHaveProperty("linkSecret");
    expect(written).not.toHaveProperty("backendOrigin");
  });

  it("bindingFromEnv reads the anon key + extras alongside the core trio", () => {
    const fromEnv = bindingFromEnv({
      SUPERCOMMENT_SUPABASE_URL: "https://ref.supabase.co",
      SUPERCOMMENT_TOKEN: "member-jwt",
      SUPERCOMMENT_PREVIEW_ID: "33333333-3333-3333-3333-333333333333",
      SUPERCOMMENT_ANON_KEY: "anon-from-env",
      SUPERCOMMENT_REFRESH_TOKEN: "refresh-from-env",
      SUPERCOMMENT_LINK_SECRET: "sk_from_env",
      SUPERCOMMENT_BACKEND_ORIGIN: "https://staging.example.com",
    });
    expect(fromEnv).toEqual({
      supabaseUrl: "https://ref.supabase.co",
      token: "member-jwt",
      previewId: "33333333-3333-3333-3333-333333333333",
      anonKey: "anon-from-env",
      refreshToken: "refresh-from-env",
      linkSecret: "sk_from_env",
      backendOrigin: "https://staging.example.com",
    });
  });

  it("bindingFromEnv returns undefined when the core trio is incomplete", () => {
    expect(
      bindingFromEnv({
        SUPERCOMMENT_SUPABASE_URL: "https://ref.supabase.co",
        SUPERCOMMENT_ANON_KEY: "anon-from-env",
        // missing TOKEN + PREVIEW_ID
      }),
    ).toBeUndefined();
  });
});
