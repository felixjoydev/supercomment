/**
 * Queue consumer — drains the `comment_queue` (R20 "Send to Claude") into the
 * local MCP/agent side.
 *
 * Outbound-only (R25): the helper PULLS pending work from Supabase over its own
 * outbound connection (it claims a row via the U2 `claim_next_queue_item` RPC,
 * delivers it to the agent sink, then finishes it via `finish_queue_item`). The
 * backend never pushes work inbound to the dev machine; a Realtime event is only
 * a hint to drain sooner, and dropping/duplicating that hint is harmless because
 * the claim RPC is the source of truth.
 *
 * Per-item lifecycle:
 *   pending --claim--> working --deliver to sink--> done
 *                                       \--sink throws--> failed (loop survives)
 *
 * Idempotency (the testable core, R20): a given `comment_id` is handled at most
 * once across (a) in-flight claims and (b) already-processed ids. The DB partial
 * unique index forbids two active rows per comment, but a row can still be
 * REDELIVERED (e.g. a duplicate enqueue after a previous done, or a re-claim of
 * the same logical work). We additionally de-dupe by `comment_id` in-process so a
 * redelivered id is never double-handed to the agent.
 */

/** A claimable queue row, mirroring the U2 `comment_queue` table (camelCased). */
export interface QueueItem {
  /** Queue row id (the unit of finish_queue_item). */
  id: string;
  previewId: string;
  /** The comment this job is for — the idempotency key. */
  commentId: string;
  status: "pending" | "working" | "done" | "failed";
  requestedBy?: string | null;
  summary?: string | null;
}

/** Terminal status a finished item lands in. */
export type FinishStatus = "done" | "failed";

/**
 * The data boundary the consumer sits on. The Supabase implementation calls the
 * U2 security-definer RPCs (`claim_next_queue_item`, `finish_queue_item`); tests
 * use an in-memory fake. Keeping the consumer purely against this interface is
 * what makes the idempotency + failure logic unit-testable.
 */
export interface QueueClient {
  /**
   * Atomically claim the next pending item for the bound preview (pending ->
   * working) and return it, or null if there is nothing pending. Mirrors
   * `claim_next_queue_item` (FOR UPDATE SKIP LOCKED).
   */
  claimNext(): Promise<QueueItem | null>;
  /** Finish a claimed item: working -> done | failed. */
  finish(itemId: string, status: FinishStatus, summary?: string): Promise<void>;
}

/**
 * Where claimed work is handed off — the MCP/agent side. Throwing here marks the
 * item 'failed' but the consumer loop continues to the next item. May return a
 * short summary string that is recorded on the finished row.
 */
export type QueueSink = (item: QueueItem) => Promise<string | void>;

export interface QueueConsumerOptions {
  client: QueueClient;
  sink: QueueSink;
  /**
   * Called when delivering an item to the sink throws. The loop survives; this
   * is for surfacing to the developer (stderr). Never includes the token.
   */
  onError?: (item: QueueItem, error: unknown) => void;
}

/**
 * Result of one drain pass, useful for tests and for the channel manager to log.
 */
export interface DrainResult {
  /** Items delivered to the sink and finished 'done'. */
  processed: number;
  /** Items whose sink threw and were finished 'failed'. */
  failed: number;
  /** Redelivered comment ids skipped (already handled / in flight). */
  skipped: number;
}

/**
 * Consumes the queue by repeated claim->deliver->finish. Idempotent by
 * `comment_id`. One instance per bound preview; call `drain()` whenever a hint
 * arrives (or on a poll), or `runForever()` to loop with a backoff between
 * empty passes.
 */
export class QueueConsumer {
  private readonly client: QueueClient;
  private readonly sink: QueueSink;
  private readonly onError?: (item: QueueItem, error: unknown) => void;

  /** comment_ids that have been (or are being) handled this process lifetime. */
  private readonly handledCommentIds = new Set<string>();
  /** Guard so two overlapping drains don't claim/deliver concurrently. */
  private draining = false;

  constructor(opts: QueueConsumerOptions) {
    this.client = opts.client;
    this.sink = opts.sink;
    this.onError = opts.onError;
  }

  /**
   * Drain every currently-pending item once. Re-entrancy safe: if a drain is in
   * progress, this returns an all-zero result rather than interleaving claims.
   */
  async drain(): Promise<DrainResult> {
    const result: DrainResult = { processed: 0, failed: 0, skipped: 0 };
    if (this.draining) return result;
    this.draining = true;
    try {
      for (;;) {
        const item = await this.client.claimNext();
        if (!item) break;

        // Idempotency: a redelivered comment_id is finished as done WITHOUT
        // re-invoking the sink, so the agent never sees the same work twice.
        if (this.handledCommentIds.has(item.commentId)) {
          result.skipped += 1;
          await this.client.finish(
            item.id,
            "done",
            "duplicate: comment already handled",
          );
          continue;
        }

        // Reserve the id BEFORE delivery so a reconnect/redelivery mid-flight is
        // also recognized as in-progress and skipped.
        this.handledCommentIds.add(item.commentId);

        try {
          const summary = await this.sink(item);
          await this.client.finish(
            item.id,
            "done",
            typeof summary === "string" ? summary : undefined,
          );
          result.processed += 1;
        } catch (error) {
          // Sink failed: mark this row failed and keep draining the rest. We
          // keep the id reserved so a redelivery of the SAME row doesn't loop
          // forever on a poison item (the backend can re-enqueue deliberately,
          // which produces a NEW comment_queue row but the same comment_id — by
          // design we then skip it rather than re-running a known-bad job).
          this.onError?.(item, error);
          await this.safeFinish(item.id, "failed", errorSummary(error));
          result.failed += 1;
        }
      }
    } finally {
      this.draining = false;
    }
    return result;
  }

  /** Finish that never throws, so a finish failure can't crash the drain loop. */
  private async safeFinish(
    itemId: string,
    status: FinishStatus,
    summary?: string,
  ): Promise<void> {
    try {
      await this.client.finish(itemId, status, summary);
    } catch (error) {
      this.onError?.(
        { id: itemId, previewId: "", commentId: "", status: "working" },
        error,
      );
    }
  }

  /** True if a comment id has already been handled (test/inspection helper). */
  hasHandled(commentId: string): boolean {
    return this.handledCommentIds.has(commentId);
  }
}

/** A compact, token-free summary for a failed delivery. */
function errorSummary(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown error";
  // Keep it short; this is stored on the queue row, not a log.
  return `failed: ${message}`.slice(0, 500);
}
