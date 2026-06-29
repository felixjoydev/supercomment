/**
 * loadReviewComments (U12) — the READ half of embedded review mode.
 *
 * The overlay is otherwise write-only. After it activates on the customer's live
 * deploy (U3 success path), it calls `list_review_comments` (0022) with the
 * reviewer's preview-scoped anon SESSION JWT and gets back the preview's existing
 * comments, which the controller renders as markers (R12). The server authorizes
 * on the session (an unexpired review_sessions row for the anon uid + preview),
 * so the client asserts nothing and reads are scoped to that one preview.
 *
 * Mirrors `submit/session.ts`: the HTTP call is an injectable `ListRpcCaller`
 * (tests pass a mock; production uses the fetch caller below, whose `fetch` is
 * itself injectable), so the arg-building + row-mapping logic is unit-tested with
 * no network. The bearer is the reviewer's anon SESSION JWT (NOT the anon key) so
 * the RPC sees `auth.uid()` = the anon user and finds the review_sessions row.
 *
 * VERIFY IN REAL ENV: the live PostgREST RPC POST (auth header, the
 * no_review_session guard, RLS bypass via SECURITY DEFINER, CORS from the
 * customer origin) cannot run in this sandbox — only arg/row mapping is tested.
 */
import type { ElementAnchor } from "@supercomment/shared";

import type { ExistingCommentMarker, Rect } from "../core/types.js";

/**
 * Positional arguments `list_review_comments` expects (mirrors
 * supabase/migrations/0022_list_review_comments.sql). The session is the
 * authority for access — the only arg is the preview to scope the read to.
 */
export interface ListReviewCommentsArgs {
  p_preview_id: string;
}

/** The raw row shape PostgREST returns from list_review_comments (snake_case). */
export interface RawReviewCommentRow {
  number?: number;
  intent?: string;
  severity?: string;
  note?: string;
  status?: string;
  is_stale?: boolean;
  context?: unknown;
  created_at?: string;
  display_name?: string;
}

/** A typed existing comment loaded back onto the live deploy. */
export interface ReviewComment {
  number: number;
  intent: string;
  severity: string;
  note: string;
  status: string;
  isStale: boolean;
  /**
   * The captured context (CapturedContext-shaped). `context.boundingBox` feeds
   * marker placement for now; U8 re-resolves position from `context.anchors`.
   */
  context: Record<string, unknown>;
  createdAt: string;
  authorDisplayName: string;
}

/**
 * Calls the list RPC by name with the given args and the current session access
 * token, returning the raw rows. Injectable: tests pass a mock; production uses
 * the fetch caller below.
 */
export type ListRpcCaller = (
  fn: string,
  args: ListReviewCommentsArgs,
  accessToken: string,
) => Promise<RawReviewCommentRow[]>;

export interface LoadReviewCommentsConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** The preview this session is scoped to (server re-checks via the JWT). */
  previewId: string;
  /**
   * Returns the current (possibly just-refreshed) anon access token. Async so
   * the caller can refresh a near-expiry token before the read.
   */
  getAccessToken: () => string | Promise<string>;
  /** Override the RPC caller (tests). Defaults to the fetch caller below. */
  rpc?: ListRpcCaller;
  /** Override `fetch` (tests). Used only by the default fetch caller. */
  fetchImpl?: typeof fetch;
}

/**
 * Load the preview's existing comments. Rejects on RPC/network failure so the
 * caller (index.ts) can fail closed (overlay stays write-only, no markers).
 */
export async function loadReviewComments(
  config: LoadReviewCommentsConfig,
): Promise<ReviewComment[]> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("loadReviewComments requires a supabaseUrl and anon key.");
  }
  if (!config.previewId) {
    throw new Error("loadReviewComments requires a previewId.");
  }

  const rpc =
    config.rpc ??
    makeFetchListRpcCaller(
      config.supabaseUrl,
      config.supabaseAnonKey,
      config.fetchImpl,
    );

  const accessToken = await config.getAccessToken();
  const rows = await rpc(
    "list_review_comments",
    { p_preview_id: config.previewId },
    accessToken,
  );

  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.number === "number")
    .map(mapRow);
}

/** Map a raw PostgREST row to a typed `ReviewComment`. */
function mapRow(row: RawReviewCommentRow): ReviewComment {
  return {
    number: row.number as number,
    intent: row.intent ?? "",
    severity: row.severity ?? "",
    note: row.note ?? "",
    status: row.status ?? "open",
    isStale: row.is_stale === true,
    context:
      row.context && typeof row.context === "object"
        ? (row.context as Record<string, unknown>)
        : {},
    createdAt: row.created_at ?? "",
    authorDisplayName: row.display_name ?? "",
  };
}

/**
 * Project loaded comments to the renderable marker shape the controller takes.
 *
 * Carries each comment's captured `context.anchors` through so the controller's
 * U8 re-anchor pass can re-resolve the live element; `rect` (capture-time
 * `context.boundingBox`) is now only the best-effort fallback position used when
 * a comment goes stale, and `isStale` is the server flag (the live pass
 * recomputes stale-ness from the anchors).
 */
export function toExistingMarkers(
  comments: ReviewComment[],
): ExistingCommentMarker[] {
  return comments.map((c) => ({
    number: c.number,
    rect: readBoundingBox(c.context),
    isStale: c.isStale,
    anchors: readAnchors(c.context),
    content: {
      note: c.note,
      authorDisplayName: c.authorDisplayName,
      intent: c.intent,
      severity: c.severity,
      status: c.status,
      createdAt: c.createdAt,
    },
  }));
}

/** Defensively read the captured `anchors` array out of a comment's context. */
function readAnchors(context: unknown): ElementAnchor[] {
  if (!context || typeof context !== "object") return [];
  const raw = (context as { anchors?: unknown }).anchors;
  if (!Array.isArray(raw)) return [];
  const out: ElementAnchor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const type = (item as { type?: unknown }).type;
    const value = (item as { value?: unknown }).value;
    if (typeof type === "string" && type && typeof value === "string") {
      out.push({ type, value });
    }
  }
  return out;
}

/** Defensively read a `{x,y,width,height}` box out of a comment's context. */
function readBoundingBox(context: unknown): Rect | null {
  if (!context || typeof context !== "object") return null;
  const box = (context as { boundingBox?: unknown }).boundingBox;
  if (!box || typeof box !== "object") return null;
  const b = box as Record<string, unknown>;
  if (
    typeof b.x === "number" &&
    typeof b.y === "number" &&
    typeof b.width === "number" &&
    typeof b.height === "number"
  ) {
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  return null;
}

/**
 * VERIFY IN REAL ENV: the live PostgREST RPC POST. The anon `apikey` is always
 * sent; the Authorization bearer is the reviewer's anon SESSION JWT (NOT the
 * anon key). `list_review_comments` returns a setof (a JSON array).
 */
export function makeFetchListRpcCaller(
  supabaseUrl: string,
  anonKey: string,
  fetchImpl?: typeof fetch,
): ListRpcCaller {
  const base = supabaseUrl.replace(/\/+$/, "");
  return async (fn, args, accessToken) => {
    const doFetch = fetchImpl ?? fetch;
    const res = await doFetch(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `list_review_comments failed (${res.status}): ${text || res.statusText}`,
      );
    }
    const data = (await res.json()) as RawReviewCommentRow[];
    return Array.isArray(data) ? data : [];
  };
}
