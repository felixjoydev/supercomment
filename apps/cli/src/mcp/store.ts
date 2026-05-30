/**
 * CommentStore — the data boundary the MCP tools sit on top of.
 *
 * The tool logic (tools.ts) is written purely against this interface so it can
 * be unit-tested with an in-memory fake, with no MCP SDK, no network, and no
 * Supabase. `SupabaseCommentStore` is the production implementation; it reads
 * comments scoped to the bound preview and calls the U2 security-definer RPCs
 * (`resolve_comment`, `dismiss_comment`) for mutations.
 *
 * Trust note (R23): the store is intentionally NOT where the guest guard lives.
 * The store faithfully returns every open comment with its `trustLevel`; the
 * guest-exclusion policy is enforced in the tool layer so the rule is visible
 * and testable in one place. `listOpenComments({ includeGuests })` simply lets
 * the tool ask for the unfiltered set when the developer explicitly opts in.
 */
import type { McpComment, TrustLevel } from "@supercomment/shared";

/** Options for listing open comments. */
export interface ListOpenOptions {
  /**
   * When true, guest-authored comments are included. The DEFAULT (false) is the
   * trusted set only — but note the store-level default returns everything and
   * the tool layer applies the guard. We thread the option through so the
   * Supabase impl can avoid fetching guest rows when not opted in.
   */
  includeGuests?: boolean;
}

/**
 * The data operations the MCP tools need. Numbers are the stable per-preview
 * comment numbers (R13); the store maps number -> id internally where needed.
 */
export interface CommentStore {
  /**
   * All OPEN comments for the bound preview, ordered by number ascending.
   * Returns every trust level (the tool layer filters guests by default).
   */
  listOpenComments(opts?: ListOpenOptions): Promise<McpComment[]>;
  /** A single comment by its per-preview number, or null if it does not exist. */
  getComment(number: number): Promise<McpComment | null>;
  /**
   * Mark a comment resolved. Returns the updated comment, or null if the number
   * does not exist. Idempotency / lifecycle rules are the store's concern.
   */
  resolveComment(number: number, summary?: string): Promise<McpComment | null>;
  /** Mark a comment dismissed. Returns the updated comment, or null if missing. */
  dismissComment(number: number, reason?: string): Promise<McpComment | null>;
}

// ---------------------------------------------------------------------------
// In-memory fake (tests)
// ---------------------------------------------------------------------------

/**
 * A deterministic in-memory CommentStore for unit tests. Seed it with comments
 * in any order; reads come back ordered by number ascending so tests can prove
 * ordering does not leak guest comments (R23).
 */
export class InMemoryCommentStore implements CommentStore {
  private readonly comments: Map<number, McpComment> = new Map();

  constructor(seed: McpComment[] = []) {
    for (const c of seed) this.comments.set(c.number, c);
  }

  private all(): McpComment[] {
    return [...this.comments.values()].sort((a, b) => a.number - b.number);
  }

  async listOpenComments(opts?: ListOpenOptions): Promise<McpComment[]> {
    const includeGuests = opts?.includeGuests ?? false;
    return this.all().filter((c) => {
      if (c.status !== "open") return false;
      if (!includeGuests && c.trustLevel === "guest") return false;
      return true;
    });
  }

  async getComment(number: number): Promise<McpComment | null> {
    return this.comments.get(number) ?? null;
  }

  async resolveComment(
    number: number,
    summary?: string,
  ): Promise<McpComment | null> {
    const existing = this.comments.get(number);
    if (!existing) return null;
    const updated: McpComment = {
      ...existing,
      status: "resolved",
      ...(summary !== undefined ? { resolvedSummary: summary } : {}),
    };
    this.comments.set(number, updated);
    return updated;
  }

  async dismissComment(
    number: number,
    reason?: string,
  ): Promise<McpComment | null> {
    const existing = this.comments.get(number);
    if (!existing) return null;
    const updated: McpComment = {
      ...existing,
      status: "dismissed",
      ...(reason !== undefined ? { resolvedSummary: reason } : {}),
    };
    this.comments.set(number, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Supabase implementation (production)
// ---------------------------------------------------------------------------

/**
 * Minimal structural type for the Supabase client we depend on, so this module
 * doesn't hard-require `@supabase/supabase-js` at type-check time and stays
 * injectable for tests. The real client (created from the binding) satisfies it.
 */
export interface SupabaseLike {
  from(table: string): {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        eq: (
          column: string,
          value: unknown,
        ) => {
          order: (
            column: string,
            opts: { ascending: boolean },
          ) => Promise<{ data: unknown[] | null; error: unknown }>;
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
        order: (
          column: string,
          opts: { ascending: boolean },
        ) => Promise<{ data: unknown[] | null; error: unknown }>;
      };
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

/** A raw `comments` row as stored by U2 (snake_case columns). */
interface CommentRow {
  id: string;
  preview_id: string;
  number: number;
  author_participant: string | null;
  trust_level: TrustLevel;
  intent: McpComment["intent"];
  severity: McpComment["severity"];
  note: string;
  path: string | null;
  context: unknown;
  status: McpComment["status"];
  fidelity: McpComment["fidelity"];
  resolved_by: string | null;
  resolved_summary: string | null;
  created_at: string;
}

/** Map a DB row to the MCP comment shape. Display name falls back gracefully. */
function rowToMcpComment(row: CommentRow): McpComment {
  const context = (row.context ?? {}) as McpComment["context"];
  return {
    id: row.id,
    previewId: row.preview_id,
    number: row.number,
    author: {
      displayName: row.author_participant ?? "Unknown",
      trustLevel: row.trust_level,
    },
    intent: row.intent,
    severity: row.severity,
    note: row.note,
    context,
    status: row.status,
    fidelity: row.fidelity,
    ...(row.resolved_by ? { resolvedBy: row.resolved_by } : {}),
    ...(row.resolved_summary
      ? { resolvedSummary: row.resolved_summary }
      : {}),
    createdAt: row.created_at,
    trustLevel: row.trust_level,
  };
}

const COMMENT_COLUMNS =
  "id, preview_id, number, author_participant, trust_level, intent, severity, " +
  "note, path, context, status, fidelity, resolved_by, resolved_summary, created_at";

/**
 * Production CommentStore backed by Supabase. Reads are scoped to the bound
 * preview and rely on RLS (the binding token carries the developer's member
 * identity, R25). Mutations go through the U2 security-definer RPCs so the
 * MCP server never writes the `comments` table directly.
 */
export class SupabaseCommentStore implements CommentStore {
  constructor(
    private readonly client: SupabaseLike,
    private readonly previewId: string,
  ) {}

  async listOpenComments(opts?: ListOpenOptions): Promise<McpComment[]> {
    // We always fetch all open rows scoped to the preview and let the tool
    // layer apply the guest guard. `includeGuests` is accepted for parity with
    // the interface but does not change the fetch (RLS already scopes by team;
    // the guard is a tool-layer policy, kept in one place for testability).
    void opts;
    const { data, error } = await this.client
      .from("comments")
      .select(COMMENT_COLUMNS)
      .eq("preview_id", this.previewId)
      .eq("status", "open")
      .order("number", { ascending: true });
    if (error) throw asError(error, "Failed to list open comments");
    return ((data ?? []) as CommentRow[]).map(rowToMcpComment);
  }

  async getComment(number: number): Promise<McpComment | null> {
    const { data, error } = await this.client
      .from("comments")
      .select(COMMENT_COLUMNS)
      .eq("preview_id", this.previewId)
      .eq("number", number)
      .maybeSingle();
    if (error) throw asError(error, `Failed to get comment #${number}`);
    if (!data) return null;
    return rowToMcpComment(data as CommentRow);
  }

  async resolveComment(
    number: number,
    summary?: string,
  ): Promise<McpComment | null> {
    const target = await this.getComment(number);
    if (!target) return null;
    const { error } = await this.client.rpc("resolve_comment", {
      p_comment_id: target.id,
      p_summary: summary ?? null,
    });
    if (error) throw asError(error, `Failed to resolve comment #${number}`);
    return this.getComment(number);
  }

  async dismissComment(
    number: number,
    reason?: string,
  ): Promise<McpComment | null> {
    const target = await this.getComment(number);
    if (!target) return null;
    const { error } = await this.client.rpc("dismiss_comment", {
      p_comment_id: target.id,
      p_reason: reason ?? null,
    });
    if (error) throw asError(error, `Failed to dismiss comment #${number}`);
    return this.getComment(number);
  }
}

function asError(error: unknown, context: string): Error {
  const detail =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return new Error(`${context}: ${detail}`);
}
