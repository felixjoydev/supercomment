/**
 * SessionLaneClient (U11) — the embedded-mode "move a comment's lane" write path
 * for a pin popover's member lane control.
 *
 * Calls the `set_comment_lane` RPC (0052) with the reviewer's anon SESSION JWT.
 * The RPC server-side re-verifies the caller holds a live member review session
 * (and, for a ready_for_agent move, the send-to-agent grant + the guest-confirm
 * gate + the reference-image unlock); the popover control is UX only. Mirrors
 * SessionAgentEnqueuer: the HTTP call is injectable (`SetLaneRpcCaller`) so the
 * logic is unit-testable with a mock, and `setLane` returns false on any failure
 * (never throws) so a failed move can never break the overlay.
 *
 * `confirmGuest` defaults to true: the member's deliberate click on the lane
 * control IS the guest-confirm acknowledgment (the overlay does not carry a
 * comment's trust level, and this matches the editor footer's send, which also
 * passes p_confirm_guest: true unconditionally). The RPC still enforces
 * can_send_to_agent, so this only unlocks a genuinely permitted send.
 */
import type { CommentLane } from "@supercomment/shared";
import type { LaneClient } from "../core/types.js";

/** Calls set_comment_lane with the current session token. Injectable. */
export type SetLaneRpcCaller = (
  commentId: string,
  lane: CommentLane,
  confirmGuest: boolean,
  accessToken: string,
) => Promise<void>;

export interface SessionLaneClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Returns the current (possibly just-refreshed) anon access token. */
  getAccessToken: () => string | Promise<string>;
  /** Override the RPC caller (tests). Defaults to a fetch-based PostgREST call. */
  rpc?: SetLaneRpcCaller;
}

export class SessionLaneClient implements LaneClient {
  private readonly getAccessToken: () => string | Promise<string>;
  private readonly rpc: SetLaneRpcCaller;

  constructor(config: SessionLaneClientConfig) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("SessionLaneClient requires a supabaseUrl and anon key.");
    }
    this.getAccessToken = config.getAccessToken;
    this.rpc =
      config.rpc ??
      makeFetchSetLaneCaller(config.supabaseUrl, config.supabaseAnonKey);
  }

  async setLane(
    commentId: string,
    lane: CommentLane,
    confirmGuest = true,
  ): Promise<boolean> {
    if (!commentId) return false;
    try {
      const accessToken = await this.getAccessToken();
      await this.rpc(commentId, lane, confirmGuest, accessToken);
      return true;
    } catch {
      return false; // best-effort: a failed move must not break the overlay
    }
  }
}

/**
 * VERIFY IN REAL ENV: the live PostgREST RPC POST. The anon `apikey` is always
 * sent; the Authorization bearer is the reviewer's anon SESSION JWT so the RPC
 * sees `auth.uid()` = the anon user and finds the member review_sessions row.
 */
function makeFetchSetLaneCaller(
  supabaseUrl: string,
  anonKey: string,
): SetLaneRpcCaller {
  const base = supabaseUrl.replace(/\/+$/, "");
  return async (commentId, lane, confirmGuest, accessToken) => {
    const res = await fetch(`${base}/rest/v1/rpc/set_comment_lane`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        p_comment_id: commentId,
        p_lane: lane,
        p_confirm_guest: confirmGuest,
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
