import { describe, it, expect } from "vitest";
import { join } from "node:path";

import {
  findRepoLink,
  applyRepoLink,
  writeRepoLink,
  matchProjectByName,
  normalizeName,
  REPO_LINK_FILE,
} from "./repo-link.js";

const enoent = () => {
  throw new Error("ENOENT");
};

describe("findRepoLink", () => {
  it("finds the nearest supercomment.json walking up from cwd", async () => {
    const linkPath = join("/repo", REPO_LINK_FILE);
    const found = await findRepoLink("/repo/apps/web", {
      readTextFile: async (p) =>
        p === linkPath
          ? JSON.stringify({ previewId: "pv1", projectId: "p1", project: "Site" })
          : enoent(),
    });
    expect(found?.link.previewId).toBe("pv1");
    expect(found?.link.project).toBe("Site");
    expect(found?.path).toBe(linkPath);
  });

  it("returns null when no link exists up to the root", async () => {
    const found = await findRepoLink("/x/y/z", { readTextFile: async () => enoent() });
    expect(found).toBeNull();
  });

  it("skips a malformed link file rather than throwing", async () => {
    const p = join("/repo", REPO_LINK_FILE);
    const found = await findRepoLink("/repo", {
      readTextFile: async (x) => (x === p ? "{ not json" : enoent()),
    });
    expect(found).toBeNull();
  });

  it("skips a link file missing previewId", async () => {
    const p = join("/repo", REPO_LINK_FILE);
    const found = await findRepoLink("/repo", {
      readTextFile: async (x) =>
        x === p ? JSON.stringify({ projectId: "p1" }) : enoent(),
    });
    expect(found).toBeNull();
  });
});

describe("applyRepoLink", () => {
  it("overrides previewId/projectId, preserves credentials, no mutation", () => {
    const binding = {
      supabaseUrl: "u",
      token: "t",
      previewId: "old",
      projectId: "oldP",
      anonKey: "a",
    };
    const out = applyRepoLink(binding, { previewId: "new", projectId: "newP" });
    expect(out.previewId).toBe("new");
    expect(out.projectId).toBe("newP");
    expect(out.token).toBe("t");
    expect(out.anonKey).toBe("a");
    expect(binding.previewId).toBe("old"); // input untouched
  });

  it("keeps the existing projectId when the link omits it", () => {
    const out = applyRepoLink({ previewId: "old", projectId: "keep" }, {
      previewId: "new",
    });
    expect(out.projectId).toBe("keep");
  });
});

describe("writeRepoLink", () => {
  it("atomically writes supercomment.json with only known fields", async () => {
    const writes: Record<string, string> = {};
    let renamed: [string, string] | null = null;
    const path = await writeRepoLink(
      "/repo",
      { previewId: "pv1", projectId: "p1", project: "Site", slug: "s1" },
      {
        mkdir: async () => undefined,
        writeFile: async (p, d) => {
          writes[p] = d;
        },
        rename: async (f, t) => {
          renamed = [f, t];
        },
      },
    );
    expect(path).toBe(join("/repo", REPO_LINK_FILE));
    const r = renamed as unknown as [string, string];
    expect(r[1]).toBe(path);
    expect(JSON.parse(writes[r[0]]!)).toEqual({
      previewId: "pv1",
      projectId: "p1",
      project: "Site",
      slug: "s1",
    });
  });
});

describe("normalizeName / matchProjectByName", () => {
  it("normalizes to lowercase alphanumerics", () => {
    expect(normalizeName("Personal website")).toBe("personalwebsite");
    expect(normalizeName("personal-website")).toBe("personalwebsite");
  });

  it("matches a unique project ignoring case/punctuation", () => {
    const projects = [
      { projectName: "Personal website", projectId: "a" },
      { projectName: "handpickedby", projectId: "b" },
    ];
    expect(matchProjectByName(["personal-website"], projects)?.projectId).toBe("a");
  });

  it("returns null on a name collision (never guesses)", () => {
    const projects = [
      { projectName: "handpickedby", projectId: "b1" },
      { projectName: "handpickedby", projectId: "b2" },
    ];
    expect(matchProjectByName(["handpickedby"], projects)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(
      matchProjectByName(["nope"], [{ projectName: "Site", projectId: "a" }]),
    ).toBeNull();
  });
});
