/**
 * Channel — the ONE authenticated OUTBOUND link from the local helper to
 * Supabase for live/offline STATUS via the heartbeat (R4), over a single
 * developer-scoped client created from the local project binding.
 *
 * The "Send to Claude" comment_queue consumer + its Realtime drain-hint were
 * RETIRED with the workflow-lanes work: sending a comment to the agent is now a
 * LANE move (set_comment_lane → ready_for_agent) that the MCP agent pulls
 * straight from the comments table, so there is no background queue to drain
 * anymore. Only the heartbeat remains — and only the legacy `supercomment start`
 * tunnel command (off by default) constructs this at all.
 *
 * OUTBOUND-ONLY (R25): the helper OPENS a client TO Supabase. Nothing here
 * listens on an inbound port; status is PUSHED out via the U2 RPCs. Everything
 * network-touching is injectable; the heartbeat loop is tested against fakes
 * (heartbeat.test.ts).
 */
import type { ProjectBinding } from "../config/binding.js";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  Heartbeat,
  type HeartbeatTimer,
  type PreviewStatus,
  type StatusUpdater,
} from "./heartbeat.js";
import { asError } from "../lib/errors.js";

/**
 * The slice of `@supabase/supabase-js` the channel needs (rpc only). Declared
 * structurally (not a hard type dep) so tests inject a fake and the module stays
 * decoupled from the SDK surface. The real client satisfies this.
 */
export interface ChannelSupabaseClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

// ---------------------------------------------------------------------------
// Production adapter (binding token -> U2 status RPCs). Injectable so tests skip it.
// ---------------------------------------------------------------------------

/**
 * Status updater backed by security-definer RPCs. 'live' calls
 * `preview_heartbeat`; 'offline' calls `preview_offline`. The bound preview id
 * scopes the write; RLS via the developer token authorizes it. The heartbeat
 * LOOP logic is fully tested via the injected updater in heartbeat.test.ts.
 */
export function makeRpcStatusUpdater(
  client: ChannelSupabaseClient,
  previewId: string,
): StatusUpdater {
  return async (status: PreviewStatus): Promise<void> => {
    const fn = status === "live" ? "preview_heartbeat" : "preview_offline";
    const { error } = await client.rpc(fn, { p_preview_id: previewId });
    if (error) throw asError(error, `${fn} failed`);
  };
}

// ---------------------------------------------------------------------------
// Channel manager (start/stop) — heartbeat only.
// ---------------------------------------------------------------------------

export interface ChannelOptions {
  /** The developer-scoped binding (id + outbound token). */
  binding: ProjectBinding;
  /** The Supabase client (created from the binding token). Injectable. */
  client: ChannelSupabaseClient;
  /** Override the status updater (defaults to the U2 RPC adapter). Tests inject. */
  statusUpdater?: StatusUpdater;
  /** Heartbeat interval. */
  heartbeatIntervalMs?: number;
  /** Injectable heartbeat timer (tests pass a manual one). */
  heartbeatTimer?: HeartbeatTimer;
  /** Surface non-fatal errors (stderr). Never receives the token. */
  onError?: (where: string, error: unknown) => void;
}

/**
 * Start/stop manager owning the heartbeat over one outbound client. `start()`
 * begins heartbeating (status -> live); `stop()` halts it (status -> offline
 * once). Only the legacy `supercomment start` command constructs this.
 */
export class Channel {
  private readonly heartbeat: Heartbeat;
  private readonly onError?: (where: string, error: unknown) => void;
  private started = false;

  constructor(opts: ChannelOptions) {
    this.onError = opts.onError;

    const statusUpdater =
      opts.statusUpdater ??
      makeRpcStatusUpdater(opts.client, opts.binding.previewId);

    this.heartbeat = new Heartbeat({
      update: statusUpdater,
      intervalMs: opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      ...(opts.heartbeatTimer ? { timer: opts.heartbeatTimer } : {}),
      onError: (status, error) => this.onError?.(`heartbeat:${status}`, error),
    });
  }

  /** Open the outbound channel: start the heartbeat (status -> live). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.heartbeat.start();
  }

  /** Close the outbound channel: stop the heartbeat (status -> offline once). */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    // Await the offline push (CLI-4) so `preview_offline` completes before the
    // caller's shutdown proceeds to process.exit().
    await this.heartbeat.stop();
  }
}
