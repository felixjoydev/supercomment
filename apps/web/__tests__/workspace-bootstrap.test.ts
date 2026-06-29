import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_REVIEW_LINK_NAME,
  needsDefaultWorkspace,
  buildDefaultReviewLinkInsert,
} from '../lib/defaults';
import { generateSlug } from '../lib/slug';

/**
 * U4 — auto-create defaults. These cover the pure decision/shape helpers that
 * ensureDefaultWorkspace() + createProject() wire into the RLS-scoped client.
 * The live insert/RPC round trips are marked VERIFY IN REAL ENV (need Supabase).
 */

describe('default-workspace bootstrap (idempotency)', () => {
  it('bootstraps a workspace only when the user has none (AE1)', () => {
    expect(needsDefaultWorkspace(0)).toBe(true);
  });

  it('never gives an existing member a second workspace', () => {
    expect(needsDefaultWorkspace(1)).toBe(false);
    expect(needsDefaultWorkspace(3)).toBe(false);
  });

  it('uses the "My Workspace" default name', () => {
    expect(DEFAULT_WORKSPACE_NAME).toBe('My Workspace');
  });
});

describe('default review link on project creation (AE2)', () => {
  it('builds a member-only review link named "Review link"', () => {
    const row = buildDefaultReviewLinkInsert('proj-123', 'abcdefghjkmn');
    expect(row.name).toBe(DEFAULT_REVIEW_LINK_NAME);
    expect(row.name).toBe('Review link');
    expect(row.project_id).toBe('proj-123');
    expect(row.slug).toBe('abcdefghjkmn');
    expect(row.status).toBe('offline');
  });

  it('keeps the DB access_mode literal as team_only (UI relabels to "Members only")', () => {
    expect(buildDefaultReviewLinkInsert('p', 's').access_mode).toBe('team_only');
  });

  it('threads a real generated slug that is a valid /s/<slug> segment', () => {
    const row = buildDefaultReviewLinkInsert('p', generateSlug());
    expect(row.slug).toMatch(/^[a-z0-9]+$/);
    expect(row.slug.length).toBe(12);
  });
});
