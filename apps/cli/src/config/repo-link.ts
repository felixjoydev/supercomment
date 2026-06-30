/**
 * Per-repo project link.
 *
 * The global binding (`~/.supercomment/binding.json`) holds CREDENTIALS (token,
 * refresh, anon key) — one per machine. But which PROJECT/preview a repo maps to
 * is per-repo, so it lives in a committed `supercomment.json` at the repo root:
 *
 *   { "previewId": "...", "projectId": "...", "project": "Personal website",
 *     "slug": "3z4hhuvssgxx" }
 *
 * It carries NO secrets, so it is safe to commit — every teammate's agent then
 * resolves the same project automatically (like `.vercel/project.json`). The MCP
 * server walks up from its cwd, finds the nearest `supercomment.json`, and scopes
 * comments to that preview — overriding the global binding's default. A repo with
 * no link falls back to the global binding (single-project users keep working).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, parse as parsePath } from "node:path";

export const REPO_LINK_FILE = "supercomment.json";

/** The repo→project link. `previewId` is authoritative; the rest is diagnostic. */
export interface RepoLink {
  previewId: string;
  projectId?: string;
  /** Human-readable project name. */
  project?: string;
  /** Review-link slug (the /s/<slug> segment, non-secret). */
  slug?: string;
}

export interface FoundRepoLink {
  link: RepoLink;
  /** Absolute path of the `supercomment.json` that was found. */
  path: string;
}

function isRepoLink(value: unknown): value is RepoLink {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.previewId === "string" &&
    o.previewId.length > 0 &&
    (o.projectId === undefined || typeof o.projectId === "string") &&
    (o.project === undefined || typeof o.project === "string") &&
    (o.slug === undefined || typeof o.slug === "string")
  );
}

export interface FindRepoLinkDeps {
  readTextFile?: (path: string) => Promise<string>;
}

/**
 * Walk up from `startDir` to the filesystem root, returning the NEAREST valid
 * `supercomment.json` (or null). A malformed/unreadable file is skipped (treated
 * as absent) rather than thrown — a broken link file must never break the MCP.
 */
export async function findRepoLink(
  startDir: string,
  deps: FindRepoLinkDeps = {},
): Promise<FoundRepoLink | null> {
  const readTextFile =
    deps.readTextFile ?? ((p: string) => readFile(p, "utf8"));
  const { root } = parsePath(startDir);
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, REPO_LINK_FILE);
    try {
      const parsed = JSON.parse(await readTextFile(candidate));
      if (isRepoLink(parsed)) {
        return { link: parsed, path: candidate };
      }
      // malformed → keep walking up rather than failing
    } catch {
      // not here / unreadable → keep walking up
    }
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Apply a repo link onto a binding-like object: override `previewId`/`projectId`,
 * preserving credentials and everything else. Pure.
 */
export function applyRepoLink<
  T extends { previewId: string; projectId?: string },
>(binding: T, link: RepoLink): T {
  return {
    ...binding,
    previewId: link.previewId,
    ...(link.projectId ? { projectId: link.projectId } : {}),
  };
}

export interface WriteRepoLinkFs {
  mkdir: (dir: string, opts: { recursive: true }) => Promise<unknown>;
  writeFile: (path: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

/** Write `supercomment.json` into `dir` (atomic). Returns the path written. */
export async function writeRepoLink(
  dir: string,
  link: RepoLink,
  fs?: WriteRepoLinkFs,
): Promise<string> {
  const ops: WriteRepoLinkFs = fs ?? {
    mkdir: (d, o) => mkdir(d, o),
    writeFile: (p, d) => writeFile(p, d),
    rename: (f, t) => rename(f, t),
  };
  const path = join(dir, REPO_LINK_FILE);
  const payload: RepoLink = {
    previewId: link.previewId,
    ...(link.projectId ? { projectId: link.projectId } : {}),
    ...(link.project ? { project: link.project } : {}),
    ...(link.slug ? { slug: link.slug } : {}),
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const tmp = `${path}.tmp-${process.pid}`;
  await ops.mkdir(dir, { recursive: true });
  await ops.writeFile(tmp, json);
  await ops.rename(tmp, path);
  return path;
}

/** Normalize a name for fuzzy matching: lowercase alphanumerics only. */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Find the UNIQUE project whose name matches one of the repo hints (e.g. the
 * directory name or git-remote repo name). Returns null when there is no match
 * OR more than one (never guesses across a collision). Pure.
 */
export function matchProjectByName<T extends { projectName: string }>(
  hints: string[],
  projects: T[],
): T | null {
  const needles = new Set(hints.map(normalizeName).filter((s) => s.length > 0));
  if (needles.size === 0) return null;
  const matches = projects.filter((p) => needles.has(normalizeName(p.projectName)));
  return matches.length === 1 ? matches[0]! : null;
}
