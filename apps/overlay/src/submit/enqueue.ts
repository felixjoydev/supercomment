/**
 * SessionAgentEnqueuer (Phase 2, now U3) — the embedded-mode "Send to agent"
 * write path.
 *
 * After the editor folds a change-set into a `template` comment, a permitted
 * MEMBER session can hand it to the coding agent. This calls the
 * `set_comment_lane` RPC (0052) with the reviewer's anon SESSION JWT to move
 * the comment into the `ready_for_agent` lane — which IS the agent's pull
 * queue (U5). The RPC server-side re-verifies the caller holds a live member
 * review session whose member is granted send-to-agent, and (guest-authored
 * comments only) records the member-only reference-image confirm marker (R11).
 * No comment_queue row is written anymore; the lane is the queue. The client
 * never asserts its own permission — the footer button is UX only.
 *
 * `p_confirm_guest` is passed as `true` unconditionally here rather than
 * threaded from the caller: the "Send to agent" footer button only ever
 * renders for a MEMBER session with the send-to-agent grant
 * (`canSendToAgent` in controller.ts's openEditPanel, sourced from
 * establish_review_session's can_send_to_agent, which is false whenever
 * member_user_id is null i.e. any guest session) AND create_review_comment
 * (0019) always stamps trust_level from the CURRENT session's role — so the
 * `template` comment this enqueues is always member-authored (trust_level =
 * 'member'), never guest-authored. The guest-confirm gate is consequently a
 * no-op on this call site; `true` is passed defensively so a future change
 * to the footer's gating can never silently start blocking sends here.
 *
 * The HTTP call is injected (`EnqueueRpcCaller`) so the logic is unit-testable
 * with a mock; the live PostgREST round-trip + the agent draining the queue are
 * real-env. `enqueue` returns false on any failure (never throws) so a failed
 * hand-off can never break the underlying save.
 */
import type { AgentEnqueuer } from "../core/types.js";

/** Calls set_comment_lane(ready_for_agent) with the current session token. Injectable. */
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
    const res = await fetch(`${base}/rest/v1/rpc/set_comment_lane`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      // See the class doc above for why p_confirm_guest is unconditionally
      // true on this call site (the comment being moved is always
      // member-authored, so the guest-confirm gate is a no-op here).
      body: JSON.stringify({
        p_comment_id: commentId,
        p_lane: "ready_for_agent",
        p_confirm_guest: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `set_comment_lane failed (${res.status}): ${text || res.statusText}`,
      );
    }
  };
}
