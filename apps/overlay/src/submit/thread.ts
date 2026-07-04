/**
 * Thread client — the overlay's read/write path for a comment's replies and
 * lifecycle, over the reviewer's preview-scoped anon SESSION JWT (same auth as
 * SessionCommentSubmitter). Replies are read straight from `comment_replies`
 * (0033 RLS admits an active session), and the write/resolve/delete actions call
 * the 0033 SECURITY DEFINER RPCs, which enforce every permission server-side:
 * reply/resolve = session or member, delete-reply = the reply's author,
 * delete-thread = the workspace owner.
 *
 * Every method is best-effort and never throws: a failed call resolves to `[]` /
 * `null` / `false`, so a dropped request can never break the popover.
 *
 * VERIFY IN REAL ENV: the live PostgREST round-trips (auth, RLS, CORS from the
 * customer origin) cannot run in the sandbox; only the arg/result shape is tested.
 */

/** One reply, as read from `comment_replies` (author name/trust denormalized). */
export interface ReplyRow {
  id: string;
  author_display_name: string;
  trust_level: string;
  body: string;
  created_at: string;
}

export interface ThreadClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Current (possibly just-refreshed) anon session access token. */
  getAccessToken: () => string | Promise<string>;
}

/** The overlay-facing thread operations. */
export interface ThreadClient {
  listReplies(commentId: string): Promise<ReplyRow[]>;
  createReply(commentId: string, body: string): Promise<ReplyRow | null>;
  resolve(commentId: string, resolved: boolean): Promise<boolean>;
  deleteReply(replyId: string): Promise<boolean>;
  deleteThread(commentId: string): Promise<boolean>;
  /** Mark a thread read/unread for the current viewer (0037/U12). */
  markRead(commentId: string): Promise<boolean>;
  markUnread(commentId: string): Promise<boolean>;
}

export class SessionThreadClient implements ThreadClient {
  private readonly base: string;
  private readonly anonKey: string;
  private readonly getAccessToken: () => string | Promise<string>;

  constructor(config: ThreadClientConfig) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("SessionThreadClient requires a supabaseUrl and anon key.");
    }
    this.base = config.supabaseUrl.replace(/\/+$/, "");
    this.anonKey = config.supabaseAnonKey;
    this.getAccessToken = config.getAccessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      "content-type": "application/json",
      apikey: this.anonKey,
      Authorization: `Bearer ${token}`,
    };
  }

  async listReplies(commentId: string): Promise<ReplyRow[]> {
    try {
      const url =
        `${this.base}/rest/v1/comment_replies` +
        `?comment_id=eq.${encodeURIComponent(commentId)}` +
        `&select=id,author_display_name,trust_level,body,created_at` +
        `&order=created_at.asc`;
      const res = await fetch(url, { headers: await this.authHeaders() });
      if (!res.ok) return [];
      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as ReplyRow[]) : [];
    } catch {
      return [];
    }
  }

  async createReply(commentId: string, body: string): Promise<ReplyRow | null> {
    return this.rpcObject<ReplyRow>("create_review_reply", {
      p_comment_id: commentId,
      p_body: body,
    });
  }

  async resolve(commentId: string, resolved: boolean): Promise<boolean> {
    return this.rpcOk("resolve_review_comment", {
      p_comment_id: commentId,
      p_resolved: resolved,
    });
  }

  async deleteReply(replyId: string): Promise<boolean> {
    return this.rpcOk("delete_review_reply", { p_reply_id: replyId });
  }

  async deleteThread(commentId: string): Promise<boolean> {
    return this.rpcOk("delete_review_thread", { p_comment_id: commentId });
  }

  async markRead(commentId: string): Promise<boolean> {
    return this.rpcOk("mark_thread_read", { p_comment_id: commentId });
  }

  async markUnread(commentId: string): Promise<boolean> {
    return this.rpcOk("mark_thread_unread", { p_comment_id: commentId });
  }

  /** POST an RPC and return its single-row result, or null on any failure. */
  private async rpcObject<T>(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<T | null> {
    try {
      const res = await fetch(`${this.base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          ...(await this.authHeaders()),
          Accept: "application/vnd.pgrst.object+json",
        },
        body: JSON.stringify(args),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as T | T[];
      return Array.isArray(data) ? (data[0] ?? null) : data;
    } catch {
      return null;
    }
  }

  /** POST an RPC and return whether it succeeded (2xx). */
  private async rpcOk(fn: string, args: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: await this.authHeaders(),
        body: JSON.stringify(args),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
