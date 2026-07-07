/**
 * Single source of truth for the raw `comments` row and its normalization.
 *
 * Both the dashboard (web `toCommentView`) and the MCP server (CLI
 * `rowToMcpComment`) read the same snake_case `comments` row from PostgREST and
 * project it onto their own view shape. This module owns:
 *   - `COMMENT_ROW_COLUMNS` — the select-column list (was duplicated 2×), and
 *   - `commentRowSchema` / `CommentRow` — the raw row shape (was duplicated 2×), and
 *   - `normalizeCommentRow` — the shared snake_case→camelCase projection with the
 *     common defaults + context coercion applied.
 *
 * REDACTION IS DELIBERATELY NOT DONE HERE. The MCP path is the agent-facing
 * untrusted-input boundary and redacts note + change-set in its own decorator;
 * the dashboard renders to trusted members and does not. Keeping redaction out
 * of the shared normalizer preserves that split.
 *
 * Pure + dependency-free (no DOM, no Supabase) so it stays node-testable.
 */
import { z } from "zod";
import {
  intentSchema,
  severitySchema,
  trustLevelSchema,
  commentStatusSchema,
  captureFidelitySchema,
  commentKindSchema,
  type CapturedContext,
  type CaptureFidelity,
  type CommentKind,
  type CommentStatus,
  type Intent,
  type McpPrivatePrompt,
  type Severity,
  type TrustLevel,
} from "./schema.js";

/**
 * The columns SELECTed for a full comment row. The single source of truth for
 * both readers. The web dashboard additionally joins
 * `participants:author_participant(display_name)` for the author name; the extra
 * `resolved_by` it selects here is harmless (ignored by the dashboard view).
 */
export const COMMENT_ROW_COLUMNS =
  "id, preview_id, number, author_participant, trust_level, intent, severity, " +
  "note, path, context, status, status_changed_at, fidelity, kind, is_stale, " +
  "resolved_by, resolved_summary, created_at";

/**
 * A raw `comments` row as returned by PostgREST (REST select) or the broadcast
 * trigger payload. All snake_case; nullable/optional fields reflect what either
 * reader may or may not receive (`author_name` rides the broadcast payload;
 * `resolved_by` is CLI-only; older rows predate `kind`/`is_stale`).
 */
export const commentRowSchema = z.object({
  id: z.string(),
  preview_id: z.string(),
  number: z.number(),
  author_participant: z.string().nullable().optional(),
  author_name: z.string().nullable().optional(),
  trust_level: trustLevelSchema,
  intent: intentSchema,
  severity: severitySchema,
  note: z.string(),
  path: z.string().nullable().optional(),
  context: z.unknown().optional(),
  status: commentStatusSchema,
  status_changed_at: z.string().nullable().optional(),
  fidelity: captureFidelitySchema.nullable().optional(),
  kind: commentKindSchema.nullable().optional(),
  is_stale: z.boolean().nullable().optional(),
  resolved_by: z.string().nullable().optional(),
  resolved_summary: z.string().nullable().optional(),
  created_at: z.string(),
});
export type CommentRow = z.infer<typeof commentRowSchema>;

/**
 * Coerce a raw `context` value to a CapturedContext object or null. The broadcast
 * trigger may deliver context as a JSON string; the REST path delivers it already
 * parsed. Accepts both, fails soft to null.
 */
export function coerceCommentContext(value: unknown): CapturedContext | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as CapturedContext)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as CapturedContext;
  return null;
}

/** The shared camelCase projection both view decorators build on (unredacted). */
export interface NormalizedCommentRow {
  id: string;
  previewId: string;
  number: number;
  authorParticipant: string | null;
  authorName: string | null;
  trustLevel: TrustLevel;
  intent: Intent;
  severity: Severity;
  note: string;
  path: string | null;
  context: CapturedContext | null;
  status: CommentStatus;
  /** When status last changed (0037); complements createdAt for unread. */
  statusChangedAt: string | null;
  fidelity: CaptureFidelity;
  kind: CommentKind;
  isStale: boolean;
  resolvedBy: string | null;
  resolvedSummary: string | null;
  createdAt: string;
  /**
   * Member-only private prompt (R1-R5). NOT sourced from this `comments`
   * row — merged in by `withPrivateExtras` from a separate member-only table
   * (see `CommentPrivateExtras`). Absent until a caller (U6) supplies it.
   */
  privatePrompt?: McpPrivatePrompt;
  /**
   * Member confirm marker for a guest reference/screenshot (R11). NOT
   * sourced from this `comments` row — merged in by `withPrivateExtras` from
   * a separate member-only table (see `CommentPrivateExtras`). Absent until a
   * caller (U7) supplies it.
   */
  referenceConfirmed?: boolean;
}

/**
 * Normalize a raw row: snake_case→camelCase, coerce context, and apply the
 * common defaults (`fidelity`→"live", `kind`→"comment", `is_stale`→false) shared
 * by both readers. No redaction, no I/O.
 */
export function normalizeCommentRow(row: CommentRow): NormalizedCommentRow {
  return {
    id: row.id,
    previewId: row.preview_id,
    number: row.number,
    authorParticipant: row.author_participant ?? null,
    authorName: row.author_name ?? null,
    trustLevel: row.trust_level,
    intent: row.intent,
    severity: row.severity,
    note: row.note,
    path: row.path ?? null,
    context: coerceCommentContext(row.context),
    status: row.status,
    statusChangedAt: row.status_changed_at ?? null,
    fidelity: row.fidelity ?? "live",
    kind: row.kind ?? "comment",
    isStale: row.is_stale ?? false,
    resolvedBy: row.resolved_by ?? null,
    resolvedSummary: row.resolved_summary ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Member-only private-prompt and reference-confirm data (R1-R5, R11). Both
 * live in a NEW member-only table introduced alongside this feature (see U2's
 * migration), NOT columns on this `comments` row — a member-only value must
 * never ride the `comments`-row realtime broadcast that guests subscribe to.
 * U6/U7 batch-fetch these separately, keyed by comment id, and pass them to
 * `withPrivateExtras` to merge onto the normalized row in one place rather
 * than each call site spreading fields ad hoc.
 */
export interface CommentPrivateExtras {
  privatePrompt?: McpPrivatePrompt;
  referenceConfirmed?: boolean;
}

/**
 * Merge U2's member-only extras onto an already-normalized row. Pure and
 * additive: a missing/empty `extras` leaves the row exactly as
 * `normalizeCommentRow` produced it, so existing callers (`rowToMcpComment`,
 * the dashboard's `toCommentView`) are unaffected until U6/U7 start passing
 * extras. This is the one seam those later units attach at instead of each
 * hand-rolling the merge.
 */
export function withPrivateExtras(
  row: NormalizedCommentRow,
  extras?: CommentPrivateExtras,
): NormalizedCommentRow {
  if (!extras) return row;
  return {
    ...row,
    ...(extras.privatePrompt !== undefined
      ? { privatePrompt: extras.privatePrompt }
      : {}),
    ...(extras.referenceConfirmed !== undefined
      ? { referenceConfirmed: extras.referenceConfirmed }
      : {}),
  };
}
