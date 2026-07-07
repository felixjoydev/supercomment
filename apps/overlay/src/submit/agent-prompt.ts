/**
 * SessionAgentPromptWriter (U5) — the overlay's member-only prompt-authoring
 * write path.
 *
 * The properties-panel footer's "Prompt for agent" field (rendered for any
 * workspace MEMBER session, R1-R3/R6 — regardless of whether that session also
 * holds the send-to-agent grant) captures a private instruction for the coding
 * agent. This writes it via `set_agent_prompt` (0043/U2) with the reviewer's
 * anon SESSION JWT, mirroring `SessionAgentEnqueuer`'s (enqueue.ts) exact
 * raw-fetch calling convention — the overlay stays supabase-js-free. The RPC
 * itself re-verifies a MEMBER session server-side (a guest session is rejected
 * there); the panel only gates on `currentUser.role` so a guest never even sees
 * the field (defense in depth, matching how `canSendToAgent` gates "Send to
 * agent").
 *
 * `write` returns false on any failure (never throws) so a failed prompt save
 * can never break the underlying comment save — mirroring `AgentEnqueuer`.
 *
 * There is deliberately no read/preload counterpart here (no
 * `get_agent_prompt` wiring): the panel only ever edits a BRAND NEW comment —
 * the footer creates the comment at save/send time, so there is no existing
 * comment id to preload a prior prompt for. `openEditPanel` in controller.ts is
 * only ever reached from a fresh element pick in edit mode
 * (`handleEditClick`), never from reopening an already-saved comment's marker
 * (that popover is a separate `MarkerLayer`/`ThreadClient` read-only flow with
 * no editor entry point) — so there is no existing-prompt-preload case in the
 * overlay today. See the U5 report for this finding.
 *
 * VERIFY IN REAL ENV: the live PostgREST RPC POST — only the wiring is typed
 * here.
 */
import type { AgentPromptWriter } from "../core/types.js";

/** Calls set_agent_prompt with the current session token. Injectable. */
export type AgentPromptRpcCaller = (
  commentId: string,
  body: string,
  accessToken: string,
) => Promise<void>;

export interface SessionAgentPromptWriterConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Returns the current (possibly just-refreshed) anon access token. */
  getAccessToken: () => string | Promise<string>;
  /** Override the RPC caller (tests). Defaults to a fetch-based PostgREST call. */
  rpc?: AgentPromptRpcCaller;
}

export class SessionAgentPromptWriter implements AgentPromptWriter {
  private readonly getAccessToken: () => string | Promise<string>;
  private readonly rpc: AgentPromptRpcCaller;

  constructor(config: SessionAgentPromptWriterConfig) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("SessionAgentPromptWriter requires a supabaseUrl and anon key.");
    }
    this.getAccessToken = config.getAccessToken;
    this.rpc =
      config.rpc ??
      makeFetchPromptCaller(config.supabaseUrl, config.supabaseAnonKey);
  }

  async write(commentId: string, body: string): Promise<boolean> {
    if (!commentId) return false;
    try {
      const accessToken = await this.getAccessToken();
      await this.rpc(commentId, body, accessToken);
      return true;
    } catch {
      return false; // best-effort: a failed prompt write must not break the save
    }
  }
}

/**
 * VERIFY IN REAL ENV: the live PostgREST RPC POST. The anon `apikey` is always
 * sent; the Authorization bearer is the reviewer's anon SESSION JWT so the RPC
 * sees `auth.uid()` = the anon user and resolves the member review_sessions row
 * (set_agent_prompt/0043).
 */
function makeFetchPromptCaller(
  supabaseUrl: string,
  anonKey: string,
): AgentPromptRpcCaller {
  const base = supabaseUrl.replace(/\/+$/, "");
  return async (commentId, body, accessToken) => {
    const res = await fetch(`${base}/rest/v1/rpc/set_agent_prompt`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ p_comment_id: commentId, p_body: body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `set_agent_prompt failed (${res.status}): ${text || res.statusText}`,
      );
    }
  };
}
