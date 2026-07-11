/**
 * Repo-discovery seam (U12).
 *
 * A single injected, CACHED seam that resolves the active preview's repo root,
 * discovers governance docs (AGENTS.md, CLAUDE.md, ...), and computes a cheap
 * design-system "maturity" fingerprint — so later units (U8 standing guidance,
 * U9 design grounding) share one correct, hermetic source instead of each
 * re-probing the filesystem per tool call (R18).
 *
 * Anchoring (R14/R16/R17): the seam is built ONCE at server startup from
 * whatever `findRepoLink` resolved from the launch cwd (see server.ts), or
 * `null` when no repo maps at all (no `supercomment.json`, or an env
 * binding). `discover(activePreviewId)` only ever returns the anchored repo's
 * real (precomputed) result when `activePreviewId` still equals the previewId
 * the anchor was resolved for. A `use_project` switch to a DIFFERENT preview
 * mid-session degrades to the default result rather than describing the
 * launch-cwd repo as though it were the newly active preview's repo — there is
 * no previewId -> repo-root reverse index in this codebase (a known, accepted
 * gap; see the plan's Open Questions).
 *
 * Caching model: the filesystem probe runs AT MOST ONCE, inside
 * `buildRepoDiscoverySeam`, before the seam object is even handed back.
 * `discover()` itself is a pure, synchronous closure over the precomputed
 * result — it does no I/O, so calling it any number of times per session never
 * re-reads the filesystem.
 *
 * Security bound: every probed path is resolved with `realpath` and checked to
 * stay within the resolved repo root's real path before it is stat'd or
 * listed — a symlink (or `..`) that escapes the root is treated as absent. The
 * heuristic here is existence/count-based only; no file CONTENT is ever read,
 * so there is no need for a content-size cap.
 */
import { isAbsolute, join, relative, sep } from "node:path";
import { readdir, realpath, stat } from "node:fs/promises";

export type Maturity = "mature" | "thin" | "indeterminate";

export interface RepoDiscoveryResult {
  /** Repo-relative paths to governance docs found, in priority order. Empty if none. */
  governanceDocs: string[];
  /** Cheap fingerprint read. */
  maturity: Maturity;
}

/**
 * The degraded/default result: no repo is positively anchored to the
 * currently active preview (no anchor at all, or the preview has switched
 * away from the anchored one). Frozen so callers can't accidentally mutate
 * the shared instance.
 */
export const DEGRADED_RESULT: RepoDiscoveryResult = Object.freeze({
  governanceDocs: [],
  maturity: "indeterminate",
});

export interface RepoDiscoverySeam {
  /**
   * Discovery result for the CURRENTLY active preview. Returns the anchored
   * repo's real result only while `activePreviewId` matches the preview the
   * seam was anchored to at construction; otherwise returns `DEGRADED_RESULT`.
   * Synchronous and side-effect-free — safe to call on every tool read.
   */
  discover(activePreviewId: string): RepoDiscoveryResult;
}

/** What the seam is anchored to: the repo root and the preview it was resolved for. */
export interface RepoAnchor {
  /** Absolute path to the repo root (the directory containing the resolved supercomment.json). */
  repoRoot: string;
  /** The previewId the repo link resolved to at anchor time. */
  anchoredPreviewId: string;
}

// ---------------------------------------------------------------------------
// Probe candidates
// ---------------------------------------------------------------------------

/**
 * Governance-doc candidates, checked at the repo root (and one level into
 * `docs/` for the design-guidelines convention), in priority order. Returned
 * paths are exactly these repo-relative strings — the agent resolves them
 * against ITS OWN repo root, so no absolute path ever leaves this module.
 */
export const GOVERNANCE_DOC_CANDIDATES: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/design-guidelines.md",
  "DESIGN.md",
  "CONTRIBUTING.md",
];

/** Design-tokens / config file candidates that signal a "mature" design system. */
const TOKEN_FILE_CANDIDATES: readonly string[] = [
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tokens.json",
  "design-tokens.json",
  "design-tokens.ts",
  "theme.ts",
  "theme.css",
];

/** Component-directory candidates checked for a meaningful file count. */
const COMPONENT_DIR_CANDIDATES: readonly string[] = [
  "components/ui",
  "src/components/ui",
];

/** Minimum file count in a component directory to count as a maturity signal. */
const COMPONENT_DIR_MATURITY_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// Filesystem seam (injectable for tests; real `node:fs/promises` by default)
// ---------------------------------------------------------------------------

export interface RepoDiscoveryFsDeps {
  /** Resolves symlinks and `..`; throws if the path does not exist. */
  realpath: (path: string) => Promise<string>;
  /** Follows symlinks (unlike `lstat`); throws if the path does not exist. */
  stat: (path: string) => Promise<{ isFile(): boolean; isDirectory(): boolean }>;
  /** Directory entry names, non-recursive. */
  readdir: (path: string) => Promise<string[]>;
}

const defaultFsDeps: RepoDiscoveryFsDeps = {
  realpath: (p) => realpath(p),
  stat: (p) => stat(p),
  readdir: (p) => readdir(p),
};

// ---------------------------------------------------------------------------
// Pure(ish) discovery computation
// ---------------------------------------------------------------------------

/**
 * Resolve `join(repoRoot, relPath)` and confirm its REAL path (symlinks
 * followed) stays within `realRoot`. Returns the resolved absolute path when
 * safe, or `null` when the candidate does not exist OR escapes the root (the
 * security bound: a symlink inside the root pointing outside it is treated as
 * absent, never read).
 */
async function resolveWithinRoot(
  repoRoot: string,
  realRoot: string,
  relPath: string,
  fs: RepoDiscoveryFsDeps,
): Promise<string | null> {
  const abs = join(repoRoot, relPath);
  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch {
    return null; // does not exist / unreadable
  }
  const rel = relative(realRoot, real);
  const escapesRoot = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  return escapesRoot ? null : abs;
}

/**
 * Compute the discovery result for a repo root by probing the filesystem.
 * Called AT MOST ONCE per anchor by `buildRepoDiscoverySeam` — never per
 * `discover()` call. Exported for direct unit testing of the heuristics.
 */
export async function computeRepoDiscovery(
  repoRoot: string,
  depsIn: Partial<RepoDiscoveryFsDeps> = {},
): Promise<RepoDiscoveryResult> {
  const fs: RepoDiscoveryFsDeps = { ...defaultFsDeps, ...depsIn };

  let realRoot: string;
  try {
    realRoot = await fs.realpath(repoRoot);
  } catch {
    // Can't even resolve the repo root itself (permissions, race, etc.) — we
    // genuinely don't know anything about this repo.
    return { governanceDocs: [], maturity: "indeterminate" };
  }

  const governanceDocs: string[] = [];
  for (const candidate of GOVERNANCE_DOC_CANDIDATES) {
    const abs = await resolveWithinRoot(repoRoot, realRoot, candidate, fs);
    if (!abs) continue;
    try {
      const st = await fs.stat(abs);
      if (st.isFile()) governanceDocs.push(candidate);
    } catch {
      // race between resolve and stat — skip, don't fail the whole read
    }
  }

  let hasTokenSignal = false;
  for (const candidate of TOKEN_FILE_CANDIDATES) {
    const abs = await resolveWithinRoot(repoRoot, realRoot, candidate, fs);
    if (!abs) continue;
    try {
      const st = await fs.stat(abs);
      if (st.isFile()) {
        hasTokenSignal = true;
        break;
      }
    } catch {
      // skip
    }
  }

  let hasComponentSignal = false;
  if (!hasTokenSignal) {
    for (const candidate of COMPONENT_DIR_CANDIDATES) {
      const abs = await resolveWithinRoot(repoRoot, realRoot, candidate, fs);
      if (!abs) continue;
      try {
        const st = await fs.stat(abs);
        if (!st.isDirectory()) continue;
        const entries = await fs.readdir(abs);
        if (entries.length >= COMPONENT_DIR_MATURITY_THRESHOLD) {
          hasComponentSignal = true;
          break;
        }
      } catch {
        // skip
      }
    }
  }

  const maturity: Maturity =
    hasTokenSignal || hasComponentSignal ? "mature" : "thin";
  return { governanceDocs, maturity };
}

// ---------------------------------------------------------------------------
// The injected seam
// ---------------------------------------------------------------------------

/**
 * Build the discovery seam. Probes the filesystem ONCE (when `anchor` is
 * non-null) and returns a seam whose `discover()` is a pure, synchronous
 * lookup thereafter — no per-call I/O, no re-probing.
 *
 * `anchor` is `null` when no repo maps to the launch cwd at all (no
 * `supercomment.json` found, or an env binding was used) — the returned seam
 * then always yields `DEGRADED_RESULT`, unconditionally, regardless of the
 * previewId `discover()` is called with.
 */
export async function buildRepoDiscoverySeam(
  anchor: RepoAnchor | null,
  deps: Partial<RepoDiscoveryFsDeps> = {},
): Promise<RepoDiscoverySeam> {
  if (!anchor) {
    return { discover: () => DEGRADED_RESULT };
  }
  const result = await computeRepoDiscovery(anchor.repoRoot, deps);
  const anchoredPreviewId = anchor.anchoredPreviewId;
  return {
    discover(activePreviewId: string): RepoDiscoveryResult {
      return activePreviewId === anchoredPreviewId ? result : DEGRADED_RESULT;
    },
  };
}
