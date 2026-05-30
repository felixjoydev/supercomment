import { describe, expect, it, vi } from "vitest";

import {
  QueueConsumer,
  type FinishStatus,
  type QueueClient,
  type QueueItem,
} from "./queue.js";

/**
 * In-memory queue fake mirroring `claim_next_queue_item` / `finish_queue_item`.
 * Seed pending items; claim moves the next pending -> working; finish records
 * the terminal status. `redeliver()` re-queues an item id to simulate a Realtime
 * redelivery / duplicate enqueue (a NEW row, same comment_id).
 */
function fakeQueue(seed: QueueItem[] = []) {
  let nextRowId = seed.length + 1;
  const items: QueueItem[] = seed.map((i) => ({ ...i }));
  const finishes: Array<{
    itemId: string;
    status: FinishStatus;
    summary?: string;
  }> = [];

  const client: QueueClient = {
    async claimNext(): Promise<QueueItem | null> {
      const next = items.find((i) => i.status === "pending");
      if (!next) return null;
      next.status = "working";
      return { ...next };
    },
    async finish(itemId, status, summary): Promise<void> {
      const row = items.find((i) => i.id === itemId);
      if (row) row.status = status;
      finishes.push({ itemId, status, ...(summary ? { summary } : {}) });
    },
  };

  return {
    client,
    finishes,
    items,
    /** Enqueue a brand-new row (new id) for an existing comment id. */
    redeliver(commentId: string): string {
      const id = `row-${nextRowId++}`;
      items.push({
        id,
        previewId: "preview-1",
        commentId,
        status: "pending",
      });
      return id;
    },
  };
}

function item(id: string, commentId: string): QueueItem {
  return { id, previewId: "preview-1", commentId, status: "pending" };
}

describe("QueueConsumer.drain", () => {
  it("claims pending -> working -> delivers to sink -> done", async () => {
    const q = fakeQueue([item("row-1", "c1"), item("row-2", "c2")]);
    const delivered: string[] = [];
    const consumer = new QueueConsumer({
      client: q.client,
      sink: async (i) => {
        delivered.push(i.commentId);
        return `handled ${i.commentId}`;
      },
    });

    const result = await consumer.drain();

    expect(delivered).toEqual(["c1", "c2"]);
    expect(result).toEqual({ processed: 2, failed: 0, skipped: 0 });
    expect(q.finishes).toEqual([
      { itemId: "row-1", status: "done", summary: "handled c1" },
      { itemId: "row-2", status: "done", summary: "handled c2" },
    ]);
    expect(q.items.every((i) => i.status === "done")).toBe(true);
  });

  it("does NOT double-process a redelivered comment_id", async () => {
    const q = fakeQueue([item("row-1", "c1")]);
    const sink = vi.fn(async () => {});
    const consumer = new QueueConsumer({ client: q.client, sink });

    const first = await consumer.drain();
    expect(first).toEqual({ processed: 1, failed: 0, skipped: 0 });
    expect(sink).toHaveBeenCalledTimes(1);

    // Same comment_id re-enqueued as a NEW row (simulated redelivery).
    q.redeliver("c1");
    const second = await consumer.drain();

    // Sink not invoked again; the duplicate row is finished 'done' as a skip.
    expect(sink).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ processed: 0, failed: 0, skipped: 1 });
    expect(consumer.hasHandled("c1")).toBe(true);
    // The redelivered row is still resolved (not left pending forever).
    expect(q.items.find((i) => i.id === "row-2")?.status).toBe("done");
  });

  it("marks 'failed' when the sink throws and the loop continues", async () => {
    const q = fakeQueue([
      item("row-1", "c1"),
      item("row-2", "c2"),
      item("row-3", "c3"),
    ]);
    const onError = vi.fn();
    const consumer = new QueueConsumer({
      client: q.client,
      onError,
      sink: async (i) => {
        if (i.commentId === "c2") throw new Error("agent boom");
      },
    });

    const result = await consumer.drain();

    expect(result).toEqual({ processed: 2, failed: 1, skipped: 0 });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "c2" }),
      expect.any(Error),
    );
    const statusById = Object.fromEntries(
      q.finishes.map((f) => [f.itemId, f.status]),
    );
    expect(statusById).toEqual({
      "row-1": "done",
      "row-2": "failed",
      "row-3": "done",
    });
    // c1 and c3 processed despite c2 failing in the middle.
    expect(q.items.find((i) => i.id === "row-3")?.status).toBe("done");
  });

  it("a known-bad comment_id is not retried on redelivery (poison guard)", async () => {
    const q = fakeQueue([item("row-1", "c1")]);
    const sink = vi.fn(async () => {
      throw new Error("always fails");
    });
    const consumer = new QueueConsumer({ client: q.client, sink });

    const first = await consumer.drain();
    expect(first.failed).toBe(1);
    expect(sink).toHaveBeenCalledTimes(1);

    q.redeliver("c1");
    const second = await consumer.drain();
    // Sink NOT called again; duplicate finished as a skip rather than re-run.
    expect(sink).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ processed: 0, failed: 0, skipped: 1 });
  });

  it("returns all-zero when there is nothing pending", async () => {
    const q = fakeQueue([]);
    const consumer = new QueueConsumer({ client: q.client, sink: async () => {} });
    expect(await consumer.drain()).toEqual({
      processed: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("survives a finish() failure without crashing the drain", async () => {
    const q = fakeQueue([item("row-1", "c1"), item("row-2", "c2")]);
    const onError = vi.fn();
    // Make finish throw for the first row only.
    const original = q.client.finish.bind(q.client);
    let finishCalls = 0;
    q.client.finish = async (id, status, summary) => {
      finishCalls += 1;
      if (finishCalls === 1) throw new Error("finish blip");
      return original(id, status, summary);
    };
    const consumer = new QueueConsumer({
      client: q.client,
      onError,
      sink: async () => {},
    });

    const result = await consumer.drain();
    // First item's finish threw -> safeFinish swallowed + onError; second ok.
    expect(onError).toHaveBeenCalled();
    expect(result.processed + result.failed).toBeGreaterThanOrEqual(1);
  });

  it("is re-entrancy safe: an overlapping drain returns all-zero", async () => {
    const q = fakeQueue([item("row-1", "c1")]);
    let resolveSink: (() => void) | undefined;
    const consumer = new QueueConsumer({
      client: q.client,
      sink: () =>
        new Promise<void>((r) => {
          resolveSink = r;
        }),
    });

    const p1 = consumer.drain();
    // While the first drain is awaiting the sink, a second drain must no-op.
    const p2 = await consumer.drain();
    expect(p2).toEqual({ processed: 0, failed: 0, skipped: 0 });

    resolveSink?.();
    const r1 = await p1;
    expect(r1.processed).toBe(1);
  });
});
