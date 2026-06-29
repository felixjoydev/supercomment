import type { AccessMode } from './link';

/**
 * Pure defaults + decisions for the auto-created workspace / review link (U4).
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
