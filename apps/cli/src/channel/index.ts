/**
 * Channel — the ONE authenticated OUTBOUND link from the local helper to
 * Supabase, wiring together:
 *   (a) live/offline status via the heartbeat (R4),
 *   (b) consumption of the "Send to Claude" comment_queue (R20),
 * over a single developer-scoped client created from the local project binding.
 *
 * OUTBOUND-ONLY (R25) — the load-bearing security property:
 *   The helper OPENS a client TO Supabase. Nothing here listens on an inbound
 *   port; the MCP server is stdio, the proxy/tunnel are U3/U4. The backend can
 *   never initiate a connection to the dev machine. Status is PUSHED out via the
 *   U2 RPCs; queued work is PULLED in by the helper claiming rows via an RPC. A
 *   Realtime subscription (also an outbound WebSocket the helper opens) is only a
 *   low-latency HINT to drain sooner — losing it degrades to polling, it never
 *   opens an inbound path.
 *
 * Everything network-touching is injectable. Tests exercise the heartbeat and
 * queue logic against fakes (see heartbeat.test.ts / queue.test.ts); the live
 * Supabase client construction, token mint, and Realtime subscription are marked
 * `// VERIFY IN REAL ENV:` because they require a real project + token.
 */
import type { ProjectBinding } from "../config/binding.js";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  Heartbeat,
  type HeartbeatTimer,
  type PreviewStatus,
  type StatusUpdater,
} from "./heartbeat.js";
import {
  QueueConsumer,
  type FinishStatus,
  type QueueClient,
  type QueueItem,
  type QueueSink,
} from "./queue.js";
import { asError } from "../lib/errors.js";
import type { DbResult } from "../supabase/types.js";

/**
 * The slice of `@supabase/supabase-js` the channel needs. Declared structurally
 * (not imported as a hard type dep) so tests inject a fake and the module stays
 * decoupled from the SDK surface. The real client satisfies this.
 */
export interface ChannelSupabaseClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
  /**
   * Realtime channel factory. Optional in the structural type because the
   * polling path works without it; when present the channel manager uses it as
   * a drain hint. Shape kept loose so a fake can stand in.
   */
  channel?: (name: string) => RealtimeChannelLike;
  removeChannel?: (channel: RealtimeChannelLike) => unknown;
}

/** Minimal Realtime channel surface used as a drain hint. */
export interface RealtimeChannelLike {
  on: (
    event: string,
    filter: Record<string, unknown>,
    cb: (payload: unknown) => void,
  ) => RealtimeChannelLike;
  subscribe: (cb?: (status: string) => void) => RealtimeChannelLike;
}

// ---------------------------------------------------------------------------
// Production adapters (binding token -> U2 RPCs). Injectable so tests skip them.
// ---------------------------------------------------------------------------

/**
 * Status updater backed by security-definer RPCs. 'live' calls
 * `preview_heartbeat`; 'offline' calls `preview_offline`. The bound preview id
 * scopes the write; RLS via the developer token authorizes it.
 *
 * VERIFY IN REAL ENV: these RPCs are U4's responsibility to add (the U2 schema
 * already has `previews.status` / `last_heartbeat_at` / `current_tunnel_url`,
 * but no heartbeat/offline RPC exists yet). This adapter defines the interface
 * U4 fills. The heartbeat LOOP logic is fully tested via the injected updater in
 * heartbeat.test.ts.
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

/**
 * QueueClient backed by the RPCs `claim_next_queue_item` / `finish_queue_item`.
 * Maps the snake_case row the RPC returns to the camelCase `QueueItem` the
 * consumer uses.
 *
 * VERIFY IN REAL ENV: these claim/finish RPCs are not yet in the migrations
 * (U2's `comment_queue` table notes "U5 will add claim/lease columns when it
 * builds the consumer"; the claim should use `FOR UPDATE SKIP LOCKED` and the
 * partial unique index already prevents two active rows per comment). This
 * adapter defines the interface; the consume/idempotency/failure LOOP logic is
 * fully tested via the injected QueueClient in queue.test.ts.
 */
export function makeRpcQueueClient(
  client: ChannelSupabaseClient,
  previewId: string,
): QueueClient {
  return {
    async claimNext(): Promise<QueueItem | null> {
      const { data, error } = await client.rpc("claim_next_queue_item", {
        p_preview_id: previewId,
      });
      if (error) throw asError(error, "claim_next_queue_item failed");
      if (!data) return null;
      // The RPC returns the table rowtype; Supabase may surface it as a single
      // object or a one-element array depending on call shape.
      const row = (Array.isArray(data) ? data[0] : data) as
        | QueueRow
        | undefined;
      if (!row) return null;
      return rowToQueueItem(row);
    },
    async finish(
      itemId: string,
      status: FinishStatus,
      summary?: string,
    ): Promise<void> {
      const { error } = await client.rpc("finish_queue_item", {
        p_item_id: itemId,
        p_status: status,
        p_summary: summary ?? null,
      });
      if (error) throw asError(error, "finish_queue_item failed");
    },
  };
}

/** Raw `comment_queue` row as the RPC returns it (snake_case). */
interface QueueRow {
  id: string;
  preview_id: string;
  comment_id: string;
  status: QueueItem["status"];
  requested_by: string | null;
  summary: string | null;
}

function rowToQueueItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    previewId: row.preview_id,
    commentId: row.comment_id,
    status: row.status,
    requestedBy: row.requested_by,
    summary: row.summary,
  };
}

// ---------------------------------------------------------------------------
// Channel manager (start/stop)
// ---------------------------------------------------------------------------

export interface ChannelOptions {
  /** The developer-scoped binding (id + outbound token). */
  binding: ProjectBinding;
  /** The Supabase client (created from the binding token). Injectable. */
  client: ChannelSupabaseClient;
  /** Where claimed "Send to Claude" work is handed to the MCP/agent side. */
  sink: QueueSink;
  /** Override the status updater (defaults to the U2 RPC adapter). Tests inject. */
  statusUpdater?: StatusUpdater;
  /** Override the queue client (defaults to the U2 RPC adapter). Tests inject. */
  queueClient?: QueueClient;
  /** Heartbeat interval. */
  heartbeatIntervalMs?: number;
  /** Injectable heartbeat timer (tests pass a manual one). */
  heartbeatTimer?: HeartbeatTimer;
  /** Surface non-fatal errors (stderr). Never receives the token. */
  onError?: (where: string, error: unknown) => void;
}

/**
 * Start/stop manager owning the heartbeat + queue consumer over one outbound
 * client. `start()` begins heartbeating (status -> live) and drains any pending
 * queue work; `stop()` halts the heartbeat (status -> offline once) and the
 * drain loop. The live Realtime drain-hint subscription is best-effort and
 * isolated so its absence/failure never blocks status or polling.
 */
export class Channel {
  private readonly binding: ProjectBinding;
  private readonly client: ChannelSupabaseClient;
  private readonly heartbeat: Heartbeat;
  private readonly consumer: QueueConsumer;
  private readonly onError?: (where: string, error: unknown) => void;

  private realtimeChannel: RealtimeChannelLike | undefined;
  private started = false;

  constructor(opts: ChannelOptions) {
    this.binding = opts.binding;
    this.client = opts.client;
    this.onError = opts.onError;

    const statusUpdater =
      opts.statusUpdater ??
      makeRpcStatusUpdater(opts.client, opts.binding.previewId);
    const queueClient =
      opts.queueClient ??
      makeRpcQueueClient(opts.client, opts.binding.previewId);

    this.heartbeat = new Heartbeat({
      update: statusUpdater,
      intervalMs: opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      ...(opts.heartbeatTimer ? { timer: opts.heartbeatTimer } : {}),
      onError: (status, error) =>
        this.onError?.(`heartbeat:${status}`, error),
    });

    this.consumer = new QueueConsumer({
      client: queueClient,
      sink: opts.sink,
      onError: (item, error) =>
        this.onError?.(`queue:${item.commentId}`, error),
    });
  }

  /** The queue consumer, exposed so a caller can `drain()` on an external hint. */
  get queue(): QueueConsumer {
    return this.consumer;
  }

  /**
   * Open the outbound channel: start the heartbeat (status -> live) and drain
   * any already-pending queue work, then subscribe to a Realtime drain hint.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.heartbeat.start();
    // Drain anything queued before we connected.
    try {
      await this.consumer.drain();
    } catch (error) {
      this.onError?.("queue:initial-drain", error);
    }
    this.subscribeRealtimeHint();
  }

  /** Close the outbound channel: stop heartbeat (offline once) + unsubscribe. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.heartbeat.stop();
    if (this.realtimeChannel && this.client.removeChannel) {
      try {
        await this.client.removeChannel(this.realtimeChannel);
      } catch (error) {
        this.onError?.("realtime:remove", error);
      }
    }
    this.realtimeChannel = undefined;
  }

  /**
   * Subscribe to a per-preview Realtime channel as a low-latency drain hint.
   *
   * VERIFY IN REAL ENV: the exact Supabase Realtime auth + private-channel
   * topic + payload shape and that this is a purely OUTBOUND WebSocket the
   * helper opens (R25). The drain logic itself is fully tested via QueueConsumer
   * against fakes; this only triggers a drain sooner. Any failure here is
   * swallowed so the polling/initial-drain path remains the source of truth.
   */
  private subscribeRealtimeHint(): void {
    if (!this.client.channel) return; // no realtime in this client (e.g. tests)
    try {
      const topic = `comment_queue:${this.binding.previewId}`;
      const ch = this.client
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "comment_queue",
            filter: `preview_id=eq.${this.binding.previewId}`,
          },
          () => {
            // Fire-and-forget drain; QueueConsumer is re-entrancy safe and
            // idempotent by comment_id, so duplicate hints are harmless.
            void this.consumer.drain().catch((error) => {
              this.onError?.("queue:hint-drain", error);
            });
          },
        )
        .subscribe();
      this.realtimeChannel = ch;
    } catch (error) {
      this.onError?.("realtime:subscribe", error);
    }
  }
}

