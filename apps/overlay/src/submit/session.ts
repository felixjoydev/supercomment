/**
 * SessionCommentSubmitter (U3) — the embedded-mode write path.
 *
 * Unlike SupabaseCommentSubmitter (tunnel mode: anon-key bearer + link secret in
 * the body), this submitter authorizes with the reviewer's preview-scoped anon
 * SESSION JWT and calls `create_review_comment` (0019), which derives trust
 * level + display name + member attribution from the server-side review_sessions
 * row — the client never sends a link secret and never asserts its own identity.
 *
 * The access token can be refreshed mid-session, so the bearer is read at submit
 * time via the injected `getAccessToken()` (index.ts wires it to a closure that
 * refreshes before expiry). The HTTP call is injected (`SessionRpcCaller`) so the
 * arg-building + result-mapping logic is unit-tested with a mock; the live
 * PostgREST round-trip (auth, RLS, CORS from the deploy origin) is isolated.
 *
 * VERIFY IN REAL ENV: the live RPC POST with a real anon session JWT (auth
 * header, the no_review_session guard, CORS from the customer origin) cannot run
 * in this sandbox — only the arg/result mapping is covered by tests.
 */
import type { NewCommentInput } from "@supercomment/shared";
import type { CommentSubmitter, SubmitResult } from "../core/types.js";
import type { CreatedCommentRow } from "./index.js";

/**
 * Positional arguments `create_review_comment` expects (mirrors
 * supabase/migrations/0019_review_sessions.sql). NOTE: no link secret, no
 * display name, no path — the session is the authority for all of those.
 */
export interface CreateReviewCommentArgs {
  p_preview_id: string;
  p_intent: string;
  p_severity: string;
  p_note: string;
  p_context: unknown;
  p_fidelity: string;
}

/**
 * Calls the review RPC with the given args and the current session access token.
 * Injectable: tests pass a mock; production uses the fetch caller below.
 */
export type SessionRpcCaller = (
  fn: string,
  args: CreateReviewCommentArgs,
  accessToken: string,
) => Promise<CreatedCommentRow>;

export interface SessionCommentSubmitterConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** The preview this session is scoped to (server re-checks via the JWT). */
  previewId: string;
  /**
   * Returns the current (possibly just-refreshed) anon access token. Async so
   * the caller can refresh a near-expiry token before the write.
   */
  getAccessToken: () => string | Promise<string>;
  /** Override the RPC caller (tests). Defaults to a fetch-based PostgREST call. */
  rpc?: SessionRpcCaller;
}

export class SessionCommentSubmitter implements CommentSubmitter {
  private readonly previewId: string;
  private readonly getAccessToken: () => string | Promise<string>;
  private readonly rpc: SessionRpcCaller;

  constructor(config: SessionCommentSubmitterConfig) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error(
        "SessionCommentSubmitter requires a supabaseUrl and anon key.",
      );
    }
    if (!config.previewId) {
      throw new Error("SessionCommentSubmitter requires a previewId.");
    }
    this.previewId = config.previewId;
    this.getAccessToken = config.getAccessToken;
    this.rpc =
      config.rpc ??
      makeFetchSessionRpcCaller(config.supabaseUrl, config.supabaseAnonKey);
  }

  async submit(payload: NewCommentInput): Promise<SubmitResult> {
    const args = this.buildArgs(payload);
    try {
      const accessToken = await this.getAccessToken();
      const row = await this.rpc("create_review_comment", args, accessToken);
      if (typeof row.number !== "number") {
        return {
          ok: false,
          number: 0,
          message: "Server did not return a comment number.",
        };
      }
      return {
        ok: true,
        number: row.number,
        ...(row.id ? { id: row.id } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        number: 0,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Map a `NewCommentInput` to `create_review_comment`'s positional arguments. */
  buildArgs(payload: NewCommentInput): CreateReviewCommentArgs {
    return {
      // The session is scoped to one preview server-side; trust that, not the
      // (cosmetic) previewId the form assembled.
      p_preview_id: this.previewId,
      p_intent: payload.intent,
      p_severity: payload.severity,
      p_note: payload.note,
      p_context: payload.context,
      p_fidelity: payload.fidelity ?? "live",
    };
  }
}

/**
 * VERIFY IN REAL ENV: the live PostgREST RPC POST. The anon `apikey` is always
 * sent; the Authorization bearer is the reviewer's anon SESSION JWT (NOT the
 * anon key) so RLS / the RPC see `auth.uid()` = the anon user and find the
 * review_sessions row.
 */
function makeFetchSessionRpcCaller(
  supabaseUrl: string,
  anonKey: string,
): SessionRpcCaller {
  const base = supabaseUrl.replace(/\/+$/, "");
  return async (fn, args, accessToken) => {
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        // Ask PostgREST to return the inserted row as a single object.
        Accept: "application/vnd.pgrst.object+json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `create_review_comment failed (${res.status}): ${text || res.statusText}`,
      );
    }
    const data = (await res.json()) as CreatedCommentRow | CreatedCommentRow[];
    return Array.isArray(data) ? (data[0] ?? {}) : data;
  };
}
