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
  /** Attached image refs (`captures` paths, 0048); signed on read for display. */
  image_refs?: string[];
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
  createReply(
    commentId: string,
    body: string,
    imageRefs?: string[],
  ): Promise<ReplyRow | null>;
  resolve(commentId: string, resolved: boolean): Promise<boolean>;
  deleteReply(replyId: string): Promise<boolean>;
  deleteThread(commentId: string): Promise<boolean>;
  /** Mark a thread read/unread for the current viewer (0037/U12). */
  markRead(commentId: string): Promise<boolean>;
  markUnread(commentId: string): Promise<boolean>;
  /**
   * Edit the author's OWN comment (note + reference images, 0050). The RPC
   * enforces author + untouched-by-others; false on any failure.
   */
  editComment(
    commentId: string,
    note: string,
    imageRefs?: string[],
  ): Promise<boolean>;
  /**
   * Sign a private `captures` object PATH into a temporary, directly-loadable
   * URL for the popover (reviewer reference images + reply images, R19). Null on
   * any failure — a broken image must never break the popover.
   */
  signCapture(path: string): Promise<string | null>;
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
        `&select=id,author_display_name,trust_level,body,created_at,image_refs` +
        `&order=created_at.asc`;
      const res = await fetch(url, { headers: await this.authHeaders() });
      if (!res.ok) return [];
      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as ReplyRow[]) : [];
    } catch {
      return [];
    }
  }

  async createReply(
    commentId: string,
    body: string,
    imageRefs: string[] = [],
  ): Promise<ReplyRow | null> {
    return this.rpcObject<ReplyRow>("create_review_reply", {
      p_comment_id: commentId,
      p_body: body,
      p_image_refs: imageRefs,
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

  async editComment(
    commentId: string,
    note: string,
    imageRefs: string[] = [],
  ): Promise<boolean> {
    return this.rpcOk("edit_review_comment", {
      p_comment_id: commentId,
      p_note: note,
      p_image_refs: imageRefs,
    });
  }

  /**
   * Sign a `captures` bucket object path into a short-lived URL so the popover
   * can render a reviewer reference image / reply image (R19). Uses the Storage
   * REST sign endpoint with the SAME auth as every other call (apikey + the anon
   * SESSION JWT); the 0027/0032 RLS authorizes the read via the review_sessions
   * row. The REST response's `signedURL` is RELATIVE (e.g.
   * `/object/sign/captures/…?token=…`) — capital-URL and NOT absolute, unlike
   * supabase-js's `signedUrl` — so the usable URL is `${base}/storage/v1${rel}`.
   * Never throws (best-effort, mirrors every method here).
   *
   * VERIFY IN REAL ENV: the live Storage sign POST (auth, the 0027/0032 RLS,
   * CORS from the customer origin) cannot run in the sandbox; only the request
   * shape + URL construction are unit-tested.
   */
  async signCapture(path: string): Promise<string | null> {
    try {
      // Encode each path SEGMENT (preserving the `/` separators) — reply/prompt
      // refs are RPC-shape-validated, but `context.referenceImages` is guest-
      // controlled and could carry `?`/`#`/space/unicode that would otherwise
      // corrupt or re-target the sign URL. Storage does an exact-name lookup, so
      // the encoded path only ever signs the caller's own object under RLS.
      const safePath = path.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(
        `${this.base}/storage/v1/object/sign/captures/${safePath}`,
        {
          method: "POST",
          headers: await this.authHeaders(),
          body: JSON.stringify({ expiresIn: 3600 }),
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { signedURL?: string };
      return data?.signedURL ? `${this.base}/storage/v1${data.signedURL}` : null;
    } catch {
      return null;
    }
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
