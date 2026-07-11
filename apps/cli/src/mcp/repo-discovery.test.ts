import { describe, expect, it, afterEach, beforeEach } from "vitest";
import {
  mkdir,
  mkdtemp,
  readdir as fsReaddir,
  realpath as fsRealpath,
  rm,
  stat as fsStat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildRepoDiscoverySeam,
  computeRepoDiscovery,
  DEGRADED_RESULT,
  GOVERNANCE_DOC_CANDIDATES,
  type RepoDiscoveryFsDeps,
} from "./repo-discovery.js";

describe("repo-discovery (U12)", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "supercomment-repo-discovery-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("finds a governance doc at the repo root", async () => {
    await writeFile(join(base, "AGENTS.md"), "# Agents\n");
    const result = await computeRepoDiscovery(base);
    expect(result.governanceDocs).toEqual(["AGENTS.md"]);
  });

  it("finds a governance doc one level into docs/", async () => {
    await mkdir(join(base, "docs"), { recursive: true });
    await writeFile(
      join(base, "docs", "design-guidelines.md"),
      "# Design guidelines\n",
    );
    const result = await computeRepoDiscovery(base);
    expect(result.governanceDocs).toEqual(["docs/design-guidelines.md"]);
  });

  it("returns governance docs in the documented priority order, only the ones present", async () => {
    await writeFile(join(base, "CLAUDE.md"), "claude");
    await writeFile(join(base, "DESIGN.md"), "design");
    const result = await computeRepoDiscovery(base);
    // Priority order per GOVERNANCE_DOC_CANDIDATES, filtered to what exists.
    const expectedOrder = GOVERNANCE_DOC_CANDIDATES.filter((c) =>
      ["CLAUDE.md", "DESIGN.md"].includes(c),
    );
    expect(result.governanceDocs).toEqual(expectedOrder);
  });

  it("yields 'mature' when a design-tokens/config file signal is present", async () => {
    await writeFile(join(base, "tailwind.config.js"), "module.exports = {};");
    const result = await computeRepoDiscovery(base);
    expect(result.maturity).toBe("mature");
  });

  it("yields 'mature' when a component directory has a meaningful file count", async () => {
    const uiDir = join(base, "components", "ui");
    await mkdir(uiDir, { recursive: true });
    for (const name of ["button.tsx", "card.tsx", "dialog.tsx", "input.tsx"]) {
      await writeFile(join(uiDir, name), "export {};");
    }
    const result = await computeRepoDiscovery(base);
    expect(result.maturity).toBe("mature");
  });

  it("yields 'thin' when neither maturity signal is present", async () => {
    // Repo root exists (and even has an unrelated file) but no token/config
    // file and no component directory.
    await writeFile(join(base, "index.ts"), "export {};");
    const result = await computeRepoDiscovery(base);
    expect(result.maturity).toBe("thin");
    expect(result.governanceDocs).toEqual([]);
  });

  it("yields 'indeterminate' when the repo root itself cannot be resolved", async () => {
    const missing = join(base, "does-not-exist");
    const result = await computeRepoDiscovery(missing);
    expect(result.maturity).toBe("indeterminate");
    expect(result.governanceDocs).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The injected seam: anchoring, degradation on preview switch, caching
  // -------------------------------------------------------------------------

  describe("buildRepoDiscoverySeam", () => {
    it("returns the anchored repo's real result only for the anchored previewId", async () => {
      await writeFile(join(base, "AGENTS.md"), "# Agents\n");
      const seam = await buildRepoDiscoverySeam({
        repoRoot: base,
        anchoredPreviewId: "pv-anchored",
      });

      expect(seam.discover("pv-anchored")).toEqual({
        governanceDocs: ["AGENTS.md"],
        maturity: "thin",
      });
    });

    it("degrades to the default result when the active preview differs from the anchor (use_project switch)", async () => {
      await writeFile(join(base, "AGENTS.md"), "# Agents\n");
      const seam = await buildRepoDiscoverySeam({
        repoRoot: base,
        anchoredPreviewId: "pv-anchored",
      });

      // A switch to a DIFFERENT preview must never describe the launch-cwd
      // repo as if it were the new preview's repo.
      expect(seam.discover("pv-other")).toEqual(DEGRADED_RESULT);
      expect(seam.discover("")).toEqual(DEGRADED_RESULT);
    });

    it("always returns the degraded default when no repo is anchored at all", async () => {
      const seam = await buildRepoDiscoverySeam(null);
      expect(seam.discover("pv-anchored")).toEqual(DEGRADED_RESULT);
      expect(seam.discover("anything-else")).toEqual(DEGRADED_RESULT);
      expect(seam.discover("")).toEqual(DEGRADED_RESULT);
    });

    it("computes the fingerprint AT MOST ONCE and never re-probes on later discover() calls", async () => {
      await writeFile(join(base, "AGENTS.md"), "# Agents\n");

      let calls = 0;
      const countingDeps: RepoDiscoveryFsDeps = {
        realpath: async (p) => {
          calls += 1;
          return fsRealpath(p);
        },
        stat: async (p) => {
          calls += 1;
          return fsStat(p);
        },
        readdir: async (p) => {
          calls += 1;
          return fsReaddir(p);
        },
      };

      const seam = await buildRepoDiscoverySeam(
        { repoRoot: base, anchoredPreviewId: "pv-anchored" },
        countingDeps,
      );
      const callsAfterBuild = calls;
      expect(callsAfterBuild).toBeGreaterThan(0); // the probe did run, once

      const first = seam.discover("pv-anchored");
      const second = seam.discover("pv-anchored");
      const third = seam.discover("pv-other"); // degraded path too does no I/O

      expect(calls).toBe(callsAfterBuild); // no fs calls made by discover()
      expect(first).toEqual(second);
      expect(first.governanceDocs).toEqual(["AGENTS.md"]);
      expect(third).toEqual(DEGRADED_RESULT);
    });
  });

  // -------------------------------------------------------------------------
  // Security bound: never read/report above the resolved repo root, even via
  // a symlink planted inside the root pointing outside it.
  // -------------------------------------------------------------------------

  describe("security: root confinement", () => {
    it("never reports a governance doc or maturity signal reached only via a symlink escaping the repo root", async () => {
      const repoRoot = join(base, "repo");
      const outside = join(base, "outside");
      await mkdir(repoRoot, { recursive: true });
      await mkdir(join(outside, "components", "ui"), { recursive: true });
      await writeFile(join(outside, "AGENTS.md"), "OUTSIDE — must not leak");
      for (const name of ["a.tsx", "b.tsx", "c.tsx", "d.tsx", "e.tsx"]) {
        await writeFile(join(outside, "components", "ui", name), "export {};");
      }

      let symlinksSupported = true;
      try {
        // A governance-doc candidate name, symlinked to a file OUTSIDE root.
        await symlink(join(outside, "AGENTS.md"), join(repoRoot, "AGENTS.md"));
        // A component-dir candidate name, symlinked to a DIRECTORY outside root
        // that would otherwise trip the 'mature' component-count signal.
        await symlink(
          join(outside, "components"),
          join(repoRoot, "components"),
        );
      } catch {
        symlinksSupported = false;
      }

      if (!symlinksSupported) {
        // Symlinks are not creatable in this sandbox/OS — skip the assertion
        // body gracefully rather than failing on an environment limitation.
        expect(true).toBe(true);
        return;
      }

      const result = await computeRepoDiscovery(repoRoot);
      expect(result.governanceDocs).toEqual([]); // escaped doc never reported
      expect(result.maturity).toBe("thin"); // escaped component dir never counted
    });
  });
});
