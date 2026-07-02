/**
 * SessionAgentEnqueuer (Phase 2) — the embedded-mode "Send to agent" write path.
 *
 * After the editor folds a change-set into a `template` comment, a permitted
 * MEMBER session can hand it to the coding agent. This calls the
 * `enqueue_review_comment` RPC (0029) with the reviewer's anon SESSION JWT; the
 * RPC server-side re-verifies the caller holds a live member review session whose
 * member is granted send-to-agent, then inserts a comment_queue row. The client
 * never asserts its own permission — the footer button is UX only.
 *
 * The HTTP call is injected (`EnqueueRpcCaller`) so the logic is unit-testable
 * with a mock; the live PostgREST round-trip + the agent draining the queue are
 * real-env. `enqueue` returns false on any failure (never throws) so a failed
 * hand-off can never break the underlying save.
 */
import type { AgentEnqueuer } from "../core/types.js";

/** Calls enqueue_review_comment with the current session token. Injectable. */
export type EnqueueRpcCaller = (
  commentId: string,
  accessToken: string,
) => Promise<void>;

export interface SessionAgentEnqueuerConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Returns the current (possibly just-refreshed) anon access token. */
  getAccessToken: () => string | Promise<string>;
  /** Override the RPC caller (tests). Defaults to a fetch-based PostgREST call. */
  rpc?: EnqueueRpcCaller;
}

export class SessionAgentEnqueuer implements AgentEnqueuer {
  private readonly getAccessToken: () => string | Promise<string>;
  private readonly rpc: EnqueueRpcCaller;

  constructor(config: SessionAgentEnqueuerConfig) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("SessionAgentEnqueuer requires a supabaseUrl and anon key.");
    }
    this.getAccessToken = config.getAccessToken;
    this.rpc =
      config.rpc ??
      makeFetchEnqueueCaller(config.supabaseUrl, config.supabaseAnonKey);
  }

  async enqueue(commentId: string): Promise<boolean> {
    if (!commentId) return false;
    try {
      const accessToken = await this.getAccessToken();
      await this.rpc(commentId, accessToken);
      return true;
    } catch {
      return false; // best-effort: a failed enqueue must not break the save
    }
  }
}

/**
 * VERIFY IN REAL ENV: the live PostgREST RPC POST. The anon `apikey` is always
 * sent; the Authorization bearer is the reviewer's anon SESSION JWT so the RPC
 * sees `auth.uid()` = the anon user and finds the member review_sessions row.
 */
function makeFetchEnqueueCaller(
  supabaseUrl: string,
  anonKey: string,
): EnqueueRpcCaller {
  const base = supabaseUrl.replace(/\/+$/, "");
  return async (commentId, accessToken) => {
    const res = await fetch(`${base}/rest/v1/rpc/enqueue_review_comment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ p_comment_id: commentId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `enqueue_review_comment failed (${res.status}): ${text || res.statusText}`,
      );
    }
  };
}
