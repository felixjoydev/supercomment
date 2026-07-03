/**
 * SuperComment shared contract.
 *
 * This module is the single source of truth for the annotation / comment shape.
 * The same Zod schemas are reused as:
 *   - the overlay -> RPC payload (`newCommentInputSchema`)
 *   - the security-definer RPC argument shape
 *   - the persisted DB row shape (`commentSchema`)
 *   - the MCP tool input / output schemas
 *
 * Keep this framework-agnostic: no React, DOM, Supabase, or Node imports.
 *
 * The schemas are split into sectioned files under ./schema/ (enums → context →
 * change-set → comment → mcp, in dependency order); this barrel re-exports them
 * so consumers keep importing from `@supercomment/shared`.
 */
export * from "./schema/enums.js";
export * from "./schema/context.js";
export * from "./schema/change-set.js";
export * from "./schema/comment.js";
export * from "./schema/mcp.js";
