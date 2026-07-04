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
import type { McpComment, McpReply, CommentRow } from "@supercomment/shared";
import {
  redactContextChangeSet,
  redactSecrets,
  normalizeCommentRow,
  COMMENT_ROW_COLUMNS,
} from "@supercomment/shared";
import { asError } from "../lib/errors.js";
import type { DbResult, DbListResult } from "../supabase/types.js";

/** A project the developer can read, with its default review link + open count. */
export interface ProjectSummary {
  projectId: string;
  projectName: string;
  /** The project's default review link, or null if it has none yet. */
  previewId: string | null;
  slug: string | null;
  openComments: number;
}

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
  /** Projects the developer can read, each with its default preview + open count. */
  listProjects(): Promise<ProjectSummary[]>;
  /** Re-scope subsequent comment reads to a different preview (runtime switch). */
  setActivePreview(previewId: string): void;
  /** The currently active preview id the reads are scoped to. */
  getActivePreview(): string;
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
  private projects: ProjectSummary[] = [];
  private activePreview = "";

  constructor(
    seed: McpComment[] = [],
    opts: { projects?: ProjectSummary[]; activePreview?: string } = {},
  ) {
    for (const c of seed) this.comments.set(c.number, c);
    this.projects = opts.projects ?? [];
    this.activePreview = opts.activePreview ?? "";
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.projects;
  }
  setActivePreview(previewId: string): void {
    this.activePreview = previewId;
  }
  getActivePreview(): string {
    return this.activePreview;
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
          ) => Promise<DbListResult>;
          maybeSingle: () => Promise<DbResult>;
        };
        order: (
          column: string,
          opts: { ascending: boolean },
        ) => Promise<DbListResult>;
      };
      // Unfiltered listing (projects / previews): select(...).order(...).
      order: (
        column: string,
        opts: { ascending: boolean },
      ) => Promise<DbListResult>;
    };
  };
  rpc(fn: string, args: Record<string, unknown>): Promise<DbResult>;
}

/**
 * Map a DB row to the MCP comment shape. Builds on the shared normalizer
 * (`normalizeCommentRow` — snake_case→camelCase + defaults + context coercion),
 * then applies the agent-facing redaction that only this (untrusted-input)
 * boundary needs.
 */
function rowToMcpComment(row: CommentRow): McpComment {
  const n = normalizeCommentRow(row);
  // U8: this is the agent-facing (untrusted-input) delivery boundary. Redact
  // reviewer-authored free-text — the visual change-set values AND the note —
  // through the canonical redactor so a token typed into an edit or note can't
  // reach the coding agent even if a malicious client skipped its own pass. The
  // rest of `context` (surrounding HTML, console) is already redacted at capture.
  const context = redactContextChangeSet(
    (n.context ?? {}) as McpComment["context"],
  );
  return {
    id: n.id,
    previewId: n.previewId,
    number: n.number,
    author: {
      displayName: n.authorParticipant ?? "Unknown",
      trustLevel: n.trustLevel,
    },
    intent: n.intent,
    severity: n.severity,
    note: redactSecrets(n.note),
    context,
    status: n.status,
    fidelity: n.fidelity,
    kind: n.kind,
    isStale: n.isStale,
    ...(n.resolvedBy ? { resolvedBy: n.resolvedBy } : {}),
    ...(n.resolvedSummary ? { resolvedSummary: n.resolvedSummary } : {}),
    createdAt: n.createdAt,
    trustLevel: n.trustLevel,
  };
}

/**
 * Production CommentStore backed by Supabase. Reads are scoped to the bound
 * preview and rely on RLS (the binding token carries the developer's member
 * identity, R25). Mutations go through the U2 security-definer RPCs so the
 * MCP server never writes the `comments` table directly.
 */
export class SupabaseCommentStore implements CommentStore {
  private previewId: string;

  constructor(
    private readonly client: SupabaseLike,
    previewId: string,
  ) {
    this.previewId = previewId;
  }

  /** Re-scope subsequent reads to a different preview (runtime project switch). */
  setActivePreview(previewId: string): void {
    this.previewId = previewId;
  }
  getActivePreview(): string {
    return this.previewId;
  }

  /**
   * List the projects the member can read (RLS scopes to their workspaces),
   * each paired with its default (earliest) review link and its open-comment
   * count. Three parallel reads, tallied client-side.
   */
  async listProjects(): Promise<ProjectSummary[]> {
    const [projRes, pvRes, openRes] = await Promise.all([
      this.client.from("projects").select("id, name").order("name", {
        ascending: true,
      }),
      this.client
        .from("previews")
        .select("id, slug, project_id")
        .order("created_at", { ascending: true }),
      this.client
        .from("comments")
        .select("preview_id")
        .eq("status", "open")
        .order("preview_id", { ascending: true }),
    ]);
    if (projRes.error) throw asError(projRes.error, "Failed to list projects");
    if (pvRes.error) throw asError(pvRes.error, "Failed to list review links");
    if (openRes.error) throw asError(openRes.error, "Failed to count comments");

    const projects = (projRes.data ?? []) as { id: string; name: string }[];
    const previews = (pvRes.data ?? []) as {
      id: string;
      slug: string;
      project_id: string;
    }[];
    const openRows = (openRes.data ?? []) as { preview_id: string }[];

    const firstPreview = new Map<string, { id: string; slug: string }>();
    for (const pv of previews) {
      if (!firstPreview.has(pv.project_id)) {
        firstPreview.set(pv.project_id, { id: pv.id, slug: pv.slug });
      }
    }
    const openByPreview = new Map<string, number>();
    for (const r of openRows) {
      openByPreview.set(r.preview_id, (openByPreview.get(r.preview_id) ?? 0) + 1);
    }

    return projects.map((p) => {
      const pv = firstPreview.get(p.id);
      return {
        projectId: p.id,
        projectName: p.name,
        previewId: pv?.id ?? null,
        slug: pv?.slug ?? null,
        openComments: pv ? (openByPreview.get(pv.id) ?? 0) : 0,
      };
    });
  }

  async listOpenComments(opts?: ListOpenOptions): Promise<McpComment[]> {
    // We always fetch all open rows scoped to the preview and let the tool
    // layer apply the guest guard. `includeGuests` is accepted for parity with
    // the interface but does not change the fetch (RLS already scopes by team;
    // the guard is a tool-layer policy, kept in one place for testability).
    void opts;
    const { data, error } = await this.client
      .from("comments")
      .select(COMMENT_ROW_COLUMNS)
      .eq("preview_id", this.previewId)
      .eq("status", "open")
      .order("number", { ascending: true });
    if (error) throw asError(error, "Failed to list open comments");
    return ((data ?? []) as CommentRow[]).map(rowToMcpComment);
  }

  async getComment(number: number): Promise<McpComment | null> {
    const { data, error } = await this.client
      .from("comments")
      .select(COMMENT_ROW_COLUMNS)
      .eq("preview_id", this.previewId)
      .eq("number", number)
      .maybeSingle();
    if (error) throw asError(error, `Failed to get comment #${number}`);
    if (!data) return null;
    const comment = rowToMcpComment(data as CommentRow);
    // Attach the discussion thread (0033) so the agent reads the whole
    // back-and-forth; the last reply is the decisive instruction.
    const thread = await this.fetchThread((data as CommentRow).id);
    return thread.length > 0 ? { ...comment, thread } : comment;
  }

  /**
   * A comment's replies in chronological order, each body redacted (untrusted
   * input, same boundary as the note). Best-effort: a read failure yields none.
   */
  private async fetchThread(commentId: string): Promise<McpReply[]> {
    const { data, error } = await this.client
      .from("comment_replies")
      .select("author_display_name, trust_level, body, created_at")
      .eq("comment_id", commentId)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (
      data as {
        author_display_name: string;
        trust_level: string;
        body: string;
        created_at: string;
      }[]
    ).map((r) => ({
      author: r.author_display_name,
      trustLevel: r.trust_level as McpReply["trustLevel"],
      body: redactSecrets(r.body),
      createdAt: r.created_at,
    }));
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

