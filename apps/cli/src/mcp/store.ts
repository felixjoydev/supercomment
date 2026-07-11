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
import type {
  McpComment,
  McpPrivatePrompt,
  McpReply,
  CommentRow,
  CapturedContext,
  TrustLevel,
} from "@supercomment/shared";
import {
  redactContextChangeSet,
  redactSecrets,
  normalizeCommentRow,
  withPrivateExtras,
  COMMENT_ROW_COLUMNS,
  resolveCaptureSrc,
  resolveFontSrc,
  type CaptureSigner,
} from "@supercomment/shared";
import { asError } from "../lib/errors.js";
import type { DbResult, DbListResult, DbSignedUrlResult } from "../supabase/types.js";

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
  /**
   * Supabase Storage (U7): the minimal slice needed to sign a `captures`
   * bucket object path into a short-lived viewable URL. Mirrors the real
   * `@supabase/supabase-js` client's `storage.from(bucket).createSignedUrl(
   * path, expiresIn)` — see `apps/web`'s dashboard signer
   * (`capture-image.tsx`) for the identical call this is modeled on.
   */
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<DbSignedUrlResult>;
    };
  };
}

/**
 * How long a signed `captures` URL stays valid after the MCP server resolves
 * it on a focus read (`getComment`). This is NOT a shareable public link —
 * only the calling agent sees it, and it is expected to fetch the image
 * within the same tool-call turn the signing happened in — so a short window
 * is correct: long enough that a slow agent turn doesn't race the expiry,
 * short enough that the URL isn't a long-lived open door into the bucket.
 */
export const CAPTURE_SIGN_TTL_SECONDS = 10 * 60;

/**
 * R18 token budget: at most this many `referenceImages` are ever resolved (or
 * even attempted) for a comment — the reviewer's LATEST upload is the design
 * target and is always kept; anything past the cap is treated as superseded
 * and dropped. The `screenshot` field is a single value, not an array, so it
 * is resolved separately and is NOT counted against this cap (documented
 * total ceiling per comment: 1 screenshot + this many reference images = 3).
 * Exported so tools.ts's `forAgent` can re-assert the identical bound as a
 * defensive safety net (see its doc) without a second, independently-chosen
 * number ever being able to drift from this one.
 */
export const MAX_RESOLVED_REFERENCE_IMAGES = 2;

/**
 * R18 token budget for THREAD reply images (R19): at most this many images
 * across the whole thread are resolved to signed URLs on the focus read,
 * NEWEST-first (the latest images are the current ask; the reviewer/developer
 * back-and-forth converges on the most recent). Slightly higher than the
 * single-comment reference cap because a thread legitimately carries more
 * back-and-forth (reviewer image → developer image → reviewer's latest). Older
 * / over-cap images stay as raw paths, present but unresolved.
 */
export const MAX_RESOLVED_THREAD_IMAGES = 3;

/**
 * R18 token budget for uploaded FONT files (U9): at most this many `font.fileRef`
 * uploads across a change-set are ever signed into the agent payload. Matches the
 * client-side per-change-set upload cap; the read side re-enforces it here so a
 * malicious change-set carrying more upload ops than the client allows can never
 * make the MCP mint more than this many signed URLs. Over-cap upload ops keep the
 * font FAMILY (for the agent to install by name) but lose the file ref.
 */
export const MAX_RESOLVED_FONT_REFS = 2;

/**
 * Single source of truth for "may this comment's captured raster(s) reach the
 * agent?" (R11/R12): a MEMBER comment's screenshot/referenceImages always
 * resolve; a GUEST comment's resolve ONLY once a developer has explicitly
 * confirmed the send (the `agent_reference_confirmations` marker, U3/U7).
 *
 * Used by BOTH this store (to decide whether a signing round trip is even
 * worth attempting — an unconfirmed guest's raster is left raw here rather
 * than burning a Storage call that would just be discarded, R18) AND
 * tools.ts's `forAgent` (to decide whether to strip what the store handed
 * back). Defined ONCE and imported by both so the resolve-vs-strip decision
 * can never diverge between the two call sites.
 */
export function shouldResolveRaster(comment: {
  trustLevel: TrustLevel;
  referenceConfirmed?: boolean;
}): boolean {
  return comment.trustLevel !== "guest" || comment.referenceConfirmed === true;
}

/**
 * May a THREAD REPLY's images (R19) reach the agent? A MEMBER reply's always
 * may (trusted author). A GUEST reply's images are an untrusted raster channel
 * admitted ONLY when a member has confirmed the send AND the reply is no newer
 * than that confirmation — the comment-level confirm approves the thread AS IT
 * WAS at `confirmedAt`, so an image a guest APPENDS afterward was never reviewed
 * and stays withheld until a fresh send re-confirms (send_comment_to_agent
 * refreshes confirmed_at on a genuine re-enqueue). This closes the gap where a
 * one-time confirmation would permanently auto-admit every later guest image.
 *
 * Fails CLOSED: an absent confirmation, or an unparseable timestamp on either
 * side, withholds the image. Used by BOTH the store (skip signing) and
 * tools.ts's `forAgent` (strip), the same defense-in-depth pairing as
 * {@link shouldResolveRaster}.
 */
export function shouldResolveReplyImage(reply: {
  trustLevel: TrustLevel;
  createdAt: string;
  referenceConfirmedAt?: string;
}): boolean {
  if (reply.trustLevel !== "guest") return true;
  if (!reply.referenceConfirmedAt) return false;
  const created = Date.parse(reply.createdAt);
  const confirmed = Date.parse(reply.referenceConfirmedAt);
  if (Number.isNaN(created) || Number.isNaN(confirmed)) return false;
  return created <= confirmed;
}

/**
 * Map a DB row to the MCP comment shape. Builds on the shared normalizer
 * (`normalizeCommentRow` — snake_case→camelCase + defaults + context coercion),
 * then applies the agent-facing redaction that only this (untrusted-input)
 * boundary needs.
 *
 * `prompt` (U6, R1-R5) is the live member-only instruction for THIS comment,
 * already batch-fetched by the caller (`fetchPrompts`) — merged on via
 * `withPrivateExtras` (U1's seam) rather than a hand-rolled spread, same as
 * the dashboard's `toCommentView` does for `referenceConfirmed` (U7): the
 * caller batch-fetches the `agent_reference_confirmations` marker
 * (`fetchReferenceConfirmations`) exactly like `fetchPrompts`, and passes the
 * presence boolean here for the same one-place merge.
 * UNREDACTED: a member's prompt is trusted-operator input (accepted per the
 * plan's Key Technical Decisions), never run through `redactSecrets` the way
 * `note`/thread bodies are — that redaction boundary exists for UNTRUSTED
 * (guest/reviewer) free text, which this is not.
 */
function rowToMcpComment(
  row: CommentRow,
  prompt?: McpPrivatePrompt,
  /** The `agent_reference_confirmations.confirmed_at` (present iff confirmed). */
  referenceConfirmedAt?: string,
): McpComment {
  const referenceConfirmed = referenceConfirmedAt !== undefined;
  const n = withPrivateExtras(normalizeCommentRow(row), {
    ...(prompt ? { privatePrompt: prompt } : {}),
    ...(referenceConfirmed ? { referenceConfirmed: true } : {}),
  });
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
    ...(n.privatePrompt ? { privatePrompt: n.privatePrompt } : {}),
    ...(n.referenceConfirmed ? { referenceConfirmed: true } : {}),
    ...(referenceConfirmedAt ? { referenceConfirmedAt } : {}),
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

  /**
   * Signs a `captures` bucket object path into a short-lived URL via THIS
   * member's own Supabase session (0027 RLS — `is_preview_workspace_member`),
   * mirroring the dashboard's `useResolvedCapture` signer exactly. Injected
   * into `resolveCaptureSrc` (the shared, SSRF-guarded resolver, U11) — never
   * called directly on a raw value without going through that classifier.
   */
  private readonly signer: CaptureSigner = async (bucket, path) => {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, CAPTURE_SIGN_TTL_SECONDS);
    if (error || !data) return null;
    return data.signedUrl;
  };

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
    // U7: the list path deliberately never resolves a raster to a signed URL
    // (R18 keeps signed-URL round trips off the hot list path) — only
    // `referenceConfirmed` is batch-fetched here, alongside prompts, so the
    // tool layer's strip-vs-pass-through decision (`shouldResolveRaster`,
    // same predicate) is correct even though nothing gets resolved yet.
    const [{ data, error }, prompts, confirmations] = await Promise.all([
      this.client
        .from("comments")
        .select(COMMENT_ROW_COLUMNS)
        .eq("preview_id", this.previewId)
        .eq("status", "open")
        .order("number", { ascending: true }),
      this.fetchPrompts(),
      this.fetchReferenceConfirmations(),
    ]);
    if (error) throw asError(error, "Failed to list open comments");
    return ((data ?? []) as CommentRow[]).map((row) =>
      rowToMcpComment(row, prompts.get(row.id), confirmations.get(row.id)),
    );
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
    const row = data as CommentRow;
    // Same fetch methods as the list path, narrowed to just this one comment
    // (code review fix, performance) — a preview-wide scan here was wasted
    // work for a preview with many active prompts/confirmations.
    const [prompts, confirmations] = await Promise.all([
      this.fetchPrompts(row.id),
      this.fetchReferenceConfirmations(row.id),
    ]);
    let comment = rowToMcpComment(
      row,
      prompts.get(row.id),
      confirmations.get(row.id),
    );
    // U7 / R10: resolve the raw captured-storage path(s) into a viewable
    // (signed) form, but ONLY on this focus read, and ONLY when the gating
    // predicate allows it — an unconfirmed guest's raster is left exactly as
    // stored here; `forAgent` (tools.ts) strips it using the SAME predicate,
    // so resolving it first would just be a wasted Storage round trip (R18).
    if (shouldResolveRaster(comment)) {
      comment = {
        ...comment,
        context: await this.resolveRasters(comment.context, comment.previewId),
      };
    }
    // Prompt images (R19) are member-authored and TRUSTED — resolve them to
    // signed URLs UNCONDITIONALLY on the focus read (no confirm gate, unlike a
    // guest's rasters), the same way the prompt body is delivered verbatim. The
    // set is already bounded by the write-side cap, so no thread-style budget.
    const promptImages = comment.privatePrompt?.imageRefs;
    if (promptImages && promptImages.length > 0) {
      const resolved = await Promise.all(
        promptImages.map(async (ref) => (await resolveCaptureSrc(ref, this.signer)) ?? ref),
      );
      comment = {
        ...comment,
        privatePrompt: { ...comment.privatePrompt!, imageRefs: resolved },
      };
    }
    // Attach the discussion thread (0033) so the agent reads the whole
    // back-and-forth; the last reply is the decisive instruction. Reply images
    // (R19) are resolved newest-first (recency = the current ask) and gated per
    // reply on the comment's confirm state (a guest reply's images ride the same
    // R11 gate as the comment's own rasters).
    const thread = await this.fetchThread(row.id);
    if (thread.length === 0) return comment;
    const resolvedThread = await this.resolveThreadImages(
      thread,
      comment.referenceConfirmedAt,
    );
    return { ...comment, thread: resolvedThread };
  }

  /**
   * Resolve `context.screenshot` and up to `MAX_RESOLVED_REFERENCE_IMAGES` of
   * `context.referenceImages` (latest-first) to a directly-viewable form via
   * the shared `resolveCaptureSrc` (a `data:image/*` value passes through
   * unchanged; a `captures` bucket path is signed via {@link signer}; the
   * DOM-snapshot fallback resolves to nothing, same as the dashboard).
   *
   * Never fails the read: EACH image is resolved independently, and
   * `resolveCaptureSrc` itself never throws. On an individual failure (the
   * signer errors, or the object no longer exists) we deliberately keep the
   * ORIGINAL raw value in that slot rather than deleting it — this is a
   * documented choice, not an oversight: dropping the field would also hide
   * its EXISTENCE from `contextSignals` (computed from this same `context` by
   * the tool layer), and the un-resolved raw value is harmless either way (a
   * bucket PATH, never a fetchable URL, so nothing "renders" from it — it's
   * exactly what the list path already exposes for the same field today).
   *
   * The cap is enforced BEFORE signing (not after): only the candidates
   * within the cap are ever passed to the signer, so a comment with far more
   * reference images than the cap never burns extra Storage round trips for
   * ones that would be dropped anyway (R18).
   */
  private async resolveRasters(
    context: CapturedContext,
    previewId: string,
  ): Promise<CapturedContext> {
    const next = { ...context };
    // Screenshot and reference images are independent Storage round trips;
    // sign them concurrently rather than awaiting the screenshot before
    // starting the (already-parallel) reference-image signing (code review
    // finding, performance).
    const refs = context.referenceImages;
    // Latest-first primacy: the most recent upload is the current ask: keep
    // it (and up to cap-1 predecessors), drop anything older.
    const candidates =
      refs && refs.length > 0
        ? [...refs].reverse().slice(0, MAX_RESOLVED_REFERENCE_IMAGES)
        : [];
    const [resolvedScreenshot, resolvedRefs] = await Promise.all([
      context.screenshot
        ? resolveCaptureSrc(context.screenshot, this.signer)
        : Promise.resolve(null),
      Promise.all(
        candidates.map(async (src) => (await resolveCaptureSrc(src, this.signer)) ?? src),
      ),
    ]);
    if (resolvedScreenshot) next.screenshot = resolvedScreenshot;
    if (candidates.length > 0) next.referenceImages = resolvedRefs;
    // U9: sign uploaded-font refs in the change-set (gated identically to the
    // rasters — this whole method only runs when shouldResolveRaster passed).
    if (next.changeSet?.ops?.length) {
      next.changeSet = await this.resolveChangeSetFonts(next.changeSet, previewId);
    }
    return next;
  }

  /**
   * Sign each `setStyle` op's uploaded `font.fileRef` (U9) into a short-lived URL,
   * PINNED to the comment's server-resolved `previewId` (never a value from the
   * change-set), capped at {@link MAX_RESOLVED_FONT_REFS}. An over-cap, unpinned,
   * or sign-failed ref is DROPPED (the op keeps the font family for install-by-
   * name) rather than left as a raw path. The caller has already applied the
   * member-or-confirmed-guest gate, so this only runs when signing is allowed.
   */
  private async resolveChangeSetFonts(
    changeSet: NonNullable<CapturedContext["changeSet"]>,
    previewId: string,
  ): Promise<NonNullable<CapturedContext["changeSet"]>> {
    // Choose the first N upload ops as sign-candidates; the rest lose their ref.
    const signable = new Set<number>();
    changeSet.ops.forEach((op, i) => {
      if (op.font?.source === "upload" && op.font.fileRef && signable.size < MAX_RESOLVED_FONT_REFS) {
        signable.add(i);
      }
    });
    const ops = await Promise.all(
      changeSet.ops.map(async (op, i) => {
        if (op.font?.source !== "upload" || !op.font.fileRef) return op;
        if (signable.has(i)) {
          const url = await resolveFontSrc(op.font.fileRef, previewId, this.signer);
          if (url) return { ...op, font: { ...op.font, fileRef: url } };
        }
        const { fileRef: _dropped, ...font } = op.font;
        return { ...op, font };
      }),
    );
    return { ...changeSet, ops };
  }

  /**
   * Live member-only prompts (0043/U2) for every comment in the bound
   * preview, keyed by comment id — ONE query, not N+1 across the open-comments
   * list. Scoped by `preview_id` (denormalized on the `agent_prompts` row,
   * 0043) rather than an explicit comment-id IN-list: this store's minimal
   * `SupabaseLike` surface has no `.in()`, and `preview_id` already bounds the
   * read to exactly the rows either caller here could need — same shape as
   * every other read in this class.
   *
   * Best-effort, mirroring `fetchThread`: `if (error || !data) return an
   * empty map` rather than throwing, so a prompt-table read failure omits the
   * trusted-prompt block instead of failing the whole comment read — the
   * prompt is additive (R4), never load-bearing for the base payload.
   *
   * A row's body is dropped (never merged) when empty/whitespace so this can
   * never surface an empty-string prompt object — "no prompt" and "cleared
   * prompt" collapse to the same `undefined`, though in practice
   * `set_agent_prompt` already DELETES a cleared row so this is a defensive
   * belt, not the primary mechanism.
   */
  /**
   * `commentId` narrows to a single row (used by `getComment`'s focus read,
   * which only ever needs one comment's prompt — a preview-wide scan there
   * was wasted work for a preview with many active prompts, code review
   * finding). Omitted, this scans the whole preview (the list path).
   */
  private async fetchPrompts(
    commentId?: string,
  ): Promise<Map<string, McpPrivatePrompt>> {
    const map = new Map<string, McpPrivatePrompt>();
    const base = this.client
      .from("agent_prompts")
      .select("comment_id, body, author_display_name, image_refs")
      .eq("preview_id", this.previewId);
    let data: unknown[] | null;
    let error: unknown;
    if (commentId) {
      const single = await base.eq("comment_id", commentId).maybeSingle();
      data = single.data ? [single.data] : [];
      error = single.error;
    } else {
      const list = await base.order("comment_id", { ascending: true });
      data = list.data;
      error = list.error;
    }
    if (error || !data) return map;
    for (const r of data as {
      comment_id: string;
      body: string;
      author_display_name: string;
      image_refs?: string[] | null;
    }[]) {
      const body = typeof r.body === "string" ? r.body : "";
      const imageRefs = Array.isArray(r.image_refs) ? r.image_refs : [];
      // An image-only prompt (empty body, images present) is a real prompt —
      // keep it; only a truly empty row (no body AND no images) is dropped.
      if (body.trim() === "" && imageRefs.length === 0) continue;
      map.set(r.comment_id, {
        body,
        authorDisplayName: r.author_display_name,
        ...(imageRefs.length > 0 ? { imageRefs } : {}),
      });
    }
    return map;
  }

  /**
   * Comment ids with a live `agent_reference_confirmations` marker (U3) for
   * the bound preview — ONE query, batch-fetched exactly like `fetchPrompts`
   * (same `preview_id`-scoped shape, same `SupabaseLike` surface, no `.in()`
   * needed). Presence-only: the row's `confirmed_by`/`confirmed_at` audit
   * columns aren't needed by the agent payload, just the boolean fact.
   *
   * Best-effort, mirroring `fetchPrompts`/`fetchThread`: a read failure
   * yields an EMPTY set, i.e. no comment's guest raster resolves — the safe
   * default under R11 (never treat a failed marker lookup as an implicit
   * confirm).
   *
   * `commentId` narrows to a single row, same rationale as `fetchPrompts`
   * (code review finding, performance) — `getComment`'s focus read only
   * ever needs one comment's marker, not the whole preview's.
   */
  private async fetchReferenceConfirmations(
    commentId?: string,
  ): Promise<Map<string, string>> {
    // comment_id → confirmed_at. Presence (has) still means "confirmed" (gates
    // the comment's OWN rasters); the timestamp additionally gates GUEST reply
    // images by recency (R19) so an image appended AFTER the confirm is withheld.
    const map = new Map<string, string>();
    const base = this.client
      .from("agent_reference_confirmations")
      .select("comment_id, confirmed_at")
      .eq("preview_id", this.previewId);
    let data: unknown[] | null;
    let error: unknown;
    if (commentId) {
      const single = await base.eq("comment_id", commentId).maybeSingle();
      data = single.data ? [single.data] : [];
      error = single.error;
    } else {
      const list = await base.order("comment_id", { ascending: true });
      data = list.data;
      error = list.error;
    }
    if (error || !data) return map;
    for (const r of data as { comment_id: string; confirmed_at?: string | null }[]) {
      map.set(r.comment_id, typeof r.confirmed_at === "string" ? r.confirmed_at : "");
    }
    return map;
  }

  /**
   * A comment's replies in chronological order, each body redacted (untrusted
   * input, same boundary as the note). Best-effort: a read failure yields none.
   */
  private async fetchThread(commentId: string): Promise<McpReply[]> {
    const { data, error } = await this.client
      .from("comment_replies")
      .select("author_display_name, trust_level, body, created_at, image_refs")
      .eq("comment_id", commentId)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (
      data as {
        author_display_name: string;
        trust_level: string;
        body: string;
        created_at: string;
        image_refs?: string[] | null;
      }[]
    ).map((r) => ({
      author: r.author_display_name,
      trustLevel: r.trust_level as McpReply["trustLevel"],
      body: redactSecrets(r.body),
      createdAt: r.created_at,
      // Raw `captures` paths here; getComment resolves the newest (recency)
      // and gates guest replies. Omitted when the reply carries no images.
      ...(r.image_refs && r.image_refs.length > 0
        ? { imageRefs: r.image_refs }
        : {}),
    }));
  }

  /**
   * Recency-weighted resolution of thread reply images (R19). Across the WHOLE
   * thread the LATEST images are the current ask, so this signs only the newest
   * `MAX_RESOLVED_THREAD_IMAGES` and leaves older / over-budget ones as raw
   * `captures` paths (their existence is still signaled, but they don't burn a
   * signed-URL round trip) — the same latest-first + cap shape `resolveRasters`
   * uses for one comment's reference images, lifted to thread scope. So a
   * reviewer who comes back after a fix with a NEW image makes THAT the resolved
   * current-ask, while earlier images stay as context.
   *
   * Gating (R11): a GUEST reply's images are an untrusted raster channel,
   * resolved ONLY when a member has confirmed the hand-off (referenceConfirmed);
   * a member reply's images always resolve. An unconfirmed guest reply's images
   * are never signed here AND are stripped by `forAgent` (the SAME predicate) —
   * a double guard, mirroring the comment-raster path. Never throws.
   */
  private async resolveThreadImages(
    thread: McpReply[],
    referenceConfirmedAt?: string,
  ): Promise<McpReply[]> {
    // Newest-first pool of every reply image. `thread` is chronological asc, so
    // walking replies (and images within a reply) from the end yields newest-first.
    const pool: { replyIdx: number; imgIdx: number; ref: string }[] = [];
    for (let r = thread.length - 1; r >= 0; r--) {
      const reply = thread[r]!;
      const refs = reply.imageRefs;
      if (!refs || refs.length === 0) continue;
      const allowed = shouldResolveReplyImage({
        trustLevel: reply.trustLevel,
        createdAt: reply.createdAt,
        referenceConfirmedAt,
      });
      if (!allowed) continue; // guest not-yet-confirmed / appended-after-confirm: forAgent strips
      for (let i = refs.length - 1; i >= 0; i--) {
        pool.push({ replyIdx: r, imgIdx: i, ref: refs[i]! });
      }
    }
    if (pool.length === 0) return thread;
    // Sign only the newest allowed images, up to the thread-wide budget.
    const toResolve = pool.slice(0, MAX_RESOLVED_THREAD_IMAGES);
    const signed = new Map<string, string>();
    await Promise.all(
      toResolve.map(async (p) => {
        const url = await resolveCaptureSrc(p.ref, this.signer);
        if (url) signed.set(`${p.replyIdx}:${p.imgIdx}`, url);
      }),
    );
    if (signed.size === 0) return thread;
    // Swap in signed URLs where resolved; keep the raw ref otherwise (older /
    // over-cap / unpermitted stay as bare paths, exactly like resolveRasters).
    return thread.map((reply, r) => {
      const refs = reply.imageRefs;
      if (!refs || refs.length === 0) return reply;
      return { ...reply, imageRefs: refs.map((ref, i) => signed.get(`${r}:${i}`) ?? ref) };
    });
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

