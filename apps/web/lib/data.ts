/**
 * Server-side data access for the dashboard, split by entity under ./data/.
 *
 * Every read/write goes through the per-request RLS-scoped client, so the
 * authenticated member only ever sees their own workspace's rows — multi-tenant
 * isolation is enforced by the U2 policies, not by these functions. They just
 * shape the queries.
 *
 * This module is a BARREL: it re-exports each entity module so consumers keep
 * importing from `@/lib/data`.
 */
export * from './data/workspaces';
export * from './data/projects';
export * from './data/previews';
export * from './data/members';
export * from './data/comments';
