import type { CapturedContext } from "@supercomment/shared";

/**
 * Deploy provenance capture (R14) — `deployUrl` + `commit`.
 *
 * Pinning each comment to the exact origin and commit it was made against lets
 * the agent fix the right revision instead of guessing against `main`.
 *
 *   - `deployUrl`: the page origin (validated as a URL so an opaque "null"
 *     origin in a sandbox is dropped rather than failing schema validation).
 *   - `commit`: best-effort from common build conventions, in priority order:
 *       1. `<meta name="sc:commit" content="...">`
 *       2. `<html data-sc-commit="...">`
 *       3. `window.__SC_COMMIT__`
 *     Only accepted when it looks like a commit SHA, so stray values are ignored.
 *
 * Read-only and entirely best-effort: absent any signal, the field is omitted.
 */

type Provenance = Pick<CapturedContext, "deployUrl" | "commit">;

const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/i;

interface LocationLike {
  origin?: string;
}

interface ViewLike {
  location?: LocationLike;
  __SC_COMMIT__?: unknown;
}

interface ElementLike {
  getAttribute?(name: string): string | null;
}

interface DocumentLike {
  documentElement?: ElementLike;
  querySelector?(selectors: string): ElementLike | null;
}

export function captureProvenance(
  view: ViewLike | undefined,
  doc: DocumentLike | undefined,
): Provenance {
  const provenance: Provenance = {};
  const origin = view?.location?.origin;
  if (origin && isValidUrl(origin)) {
    provenance.deployUrl = origin;
  }
  const commit = readCommit(view, doc);
  if (commit) {
    provenance.commit = commit;
  }
  return provenance;
}

function isValidUrl(value: string): boolean {
  try {
    // Opaque origins serialize to the string "null", which is not a URL.
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function readCommit(
  view: ViewLike | undefined,
  doc: DocumentLike | undefined,
): string | undefined {
  const candidates: Array<string | null | undefined> = [];
  try {
    candidates.push(
      doc?.querySelector?.('meta[name="sc:commit"]')?.getAttribute?.("content"),
    );
  } catch {
    // Bad selector support in a DOM double — ignore.
  }
  candidates.push(doc?.documentElement?.getAttribute?.("data-sc-commit"));
  const global = view?.__SC_COMMIT__;
  if (typeof global === "string") {
    candidates.push(global);
  }
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && COMMIT_PATTERN.test(value)) {
      return value;
    }
  }
  return undefined;
}
