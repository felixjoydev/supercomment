import type { AccessMode } from './link';
import { generateSlug } from './slug';

/**
 * Pure defaults + decisions for the auto-created workspace / review link (U4),
 * plus the slug-collision retry policy shared by the two preview creators.
 *
 * Kept free of React / Next / Supabase imports (relative imports only) so it is
 * unit-testable in the node test env, following the repo's "all testable logic
 * is pure" convention. data.ts wires these into the RLS-scoped client calls.
 */

/** Name of the workspace auto-created for a brand-new user on first load (R4). */
export const DEFAULT_WORKSPACE_NAME = 'My Workspace';

/** Name of the review link auto-created with every new project (R5). */
export const DEFAULT_REVIEW_LINK_NAME = 'Review link';

/** The columns we set when inserting a default review link (`previews` row). */
export interface DefaultReviewLinkInsert {
  project_id: string;
  name: string;
  slug: string;
  /**
   * DB literal — kept as 'team_only' (displayed as "Members only" in the UI).
   * Member-safe by default; the owner flips to a guest link to share externally.
   */
  access_mode: AccessMode;
  status: 'offline';
}

/**
 * Whether a user needs a default workspace bootstrapped — true only when they
 * have none. Makes the bootstrap idempotent: an existing member is never given
 * a second workspace.
 */
export function needsDefaultWorkspace(workspaceCount: number): boolean {
  return workspaceCount === 0;
}

/**
 * Build the insert payload for a project's one default review link. The
 * access_mode literal stays 'team_only' (HARD constraint — relabel in UI only);
 * the slug is the caller-generated, non-secret /s/<slug> path segment.
 */
export function buildDefaultReviewLinkInsert(
  projectId: string,
  slug: string,
): DefaultReviewLinkInsert {
  return {
    project_id: projectId,
    name: DEFAULT_REVIEW_LINK_NAME,
    slug,
    access_mode: 'team_only',
    status: 'offline',
  };
}

/** Outcome of {@link insertPreviewWithSlugRetry}. */
export type SlugRetryOutcome =
  | { ok: true }
  | { ok: false; error: { code?: string; message?: string } | null };

/**
 * The insert-with-slug-retry policy shared by the two default-review-link /
 * preview creators (createProject's default link in data.ts, and
 * POST /api/previews).
 *
 * A preview's `slug` is UNIQUE, so a freshly generated slug can — astronomically
 * rarely — collide (Postgres 23505). This runs `attempt(slug)` with a fresh
 * generated slug up to `attempts` times, retrying ONLY on 23505 and surfacing
 * any other error. `attempt` performs one insert (with whatever columns /
 * `.select()` the caller needs — keeping the SELECT string a literal at the call
 * site) and returns its PostgREST error, or null on success. Each caller keeps
 * its own result handling (throw vs HTTP response):
 *
 *   - { ok: true }               — an attempt succeeded.
 *   - { ok: false; error }       — a non-collision error (the real failure).
 *   - { ok: false; error: null } — every attempt collided (slug exhausted).
 */
export async function insertPreviewWithSlugRetry(
  attempt: (slug: string) => Promise<{ code?: string; message?: string } | null>,
  attempts = 2,
): Promise<SlugRetryOutcome> {
  for (let i = 0; i < attempts; i++) {
    const error = await attempt(generateSlug());
    if (!error) return { ok: true };
    // 23505 = unique_violation (slug). Anything else is a real failure.
    if (error.code !== '23505') return { ok: false, error };
  }
  return { ok: false, error: null };
}
