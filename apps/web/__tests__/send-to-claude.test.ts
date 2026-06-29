import { describe, it, expect, vi } from "vitest";

import { canEnqueue, requiresGuestConfirm } from "../lib/comments/view";
import type { CommentView } from "../lib/comments/types";
import {
  sendReducer,
  sendButtonLabel,
  isInFlight,
  sendStateFromQueueStatus,
  type SendState,
} from "../lib/comments/send-state";
import { handoffSourceRef, sourceRefFromContext } from "../lib/comments/handoff";
import type { CapturedContext } from "@supercomment/shared";

/**
 * U9 Send-to-Claude — R20 enqueue + R23 guest-confirm gate, plus the pure
 * button state machine (sent → working → failed). Node env, pure logic +
 * mocked Supabase insert client; no DOM/network.
 *
 * VERIFY IN REAL ENV: the local MCP queue consumer (U5/U12) actually reading
 * the comment_queue row over the outbound channel and reporting working→done
 * cannot be exercised here.
 */

function comment(trust: "member" | "guest"): Pick<CommentView, "trustLevel"> {
  return { trustLevel: trust };
}

describe("R23 guest-confirm gate (canEnqueue / requiresGuestConfirm)", () => {
  it("member comment never requires confirm and enqueues directly", () => {
    expect(requiresGuestConfirm(comment("member"))).toBe(false);
    expect(canEnqueue(comment("member"), false)).toEqual({ ok: true });
  });

  it("guest comment requires confirm and is BLOCKED until confirmed", () => {
    expect(requiresGuestConfirm(comment("guest"))).toBe(true);
    expect(canEnqueue(comment("guest"), false)).toEqual({
      ok: false,
      reason: "guest_confirm_required",
    });
  });

  it("guest comment enqueues once explicitly confirmed", () => {
    expect(canEnqueue(comment("guest"), true)).toEqual({ ok: true });
  });
});

describe("server enqueue path (mocked) honors the R23 gate", () => {
  // Mirrors app/api/send-to-claude/route.ts decision logic against a mocked
  // Supabase insert builder.
  function fakeInsert() {
    const insert = vi.fn().mockReturnValue({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "q1", status: "pending" }, error: null }) }),
    });
    return { from: () => ({ insert }), _insert: insert };
  }

  async function enqueueIfAllowed(
    c: Pick<CommentView, "trustLevel"> & { id: string; previewId: string },
    confirmGuest: boolean,
    supabase: ReturnType<typeof fakeInsert>,
  ) {
    const gate = canEnqueue(c, confirmGuest);
    if (!gate.ok) return { status: 409 as const, reason: gate.reason };
    const res = await supabase
      .from()
      .insert({ preview_id: c.previewId, comment_id: c.id, status: "pending" })
      .select("id, status")
      .maybeSingle();
    return { status: 201 as const, data: res.data };
  }

  it("MEMBER comment enqueues directly (inserts a pending queue row)", async () => {
    const supabase = fakeInsert();
    const r = await enqueueIfAllowed({ id: "c1", previewId: "p1", trustLevel: "member" }, false, supabase);
    expect(r.status).toBe(201);
    expect(supabase._insert).toHaveBeenCalledTimes(1);
    expect((r as { data: { status: string } }).data.status).toBe("pending");
  });

  it("GUEST comment without confirm is rejected with 409 and never inserts", async () => {
    const supabase = fakeInsert();
    const r = await enqueueIfAllowed({ id: "c2", previewId: "p1", trustLevel: "guest" }, false, supabase);
    expect(r.status).toBe(409);
    expect(supabase._insert).not.toHaveBeenCalled();
  });

  it("GUEST comment WITH explicit confirm enqueues", async () => {
    const supabase = fakeInsert();
    const r = await enqueueIfAllowed({ id: "c3", previewId: "p1", trustLevel: "guest" }, true, supabase);
    expect(r.status).toBe(201);
    expect(supabase._insert).toHaveBeenCalledTimes(1);
  });
});

describe("send button state machine", () => {
  it("member flow: idle → sending → sent (succeeded)", () => {
    let s: SendState = "idle";
    s = sendReducer(s, { type: "request", requiresConfirm: false });
    expect(s).toBe("sending");
    s = sendReducer(s, { type: "succeeded" });
    expect(s).toBe("sent");
  });

  it("guest flow: idle → confirm_required → (confirm) sending → sent", () => {
    let s: SendState = "idle";
    s = sendReducer(s, { type: "request", requiresConfirm: true });
    expect(s).toBe("confirm_required");
    s = sendReducer(s, { type: "confirm" });
    expect(s).toBe("sending");
    s = sendReducer(s, { type: "succeeded" });
    expect(s).toBe("sent");
  });

  it("cancel from confirm_required returns to idle", () => {
    let s: SendState = sendReducer("idle", { type: "request", requiresConfirm: true });
    s = sendReducer(s, { type: "cancel" });
    expect(s).toBe("idle");
  });

  it("represents sent → working → failed and supports retry", () => {
    let s: SendState = "sent";
    s = sendReducer(s, { type: "working" });
    expect(s).toBe("working");
    s = sendReducer(s, { type: "failed" });
    expect(s).toBe("failed");
    // retry: a fresh request from failed goes back to sending
    s = sendReducer(s, { type: "request", requiresConfirm: false });
    expect(s).toBe("sending");
  });

  it("completed marks done", () => {
    expect(sendReducer("working", { type: "completed" })).toBe("done");
  });

  it("isInFlight true for sending/sent/working only", () => {
    expect(isInFlight("sending")).toBe(true);
    expect(isInFlight("sent")).toBe(true);
    expect(isInFlight("working")).toBe(true);
    expect(isInFlight("idle")).toBe(false);
    expect(isInFlight("failed")).toBe(false);
    expect(isInFlight("done")).toBe(false);
  });

  it("maps queue status onto button state", () => {
    expect(sendStateFromQueueStatus("pending")).toBe("sent");
    expect(sendStateFromQueueStatus("working")).toBe("working");
    expect(sendStateFromQueueStatus("done")).toBe("done");
    expect(sendStateFromQueueStatus("failed")).toBe("failed");
  });

  it("labels reflect the state", () => {
    expect(sendButtonLabel("idle")).toBe("Send to Claude");
    expect(sendButtonLabel("confirm_required")).toBe("Confirm send");
    expect(sendButtonLabel("sent")).toBe("Queued");
    expect(sendButtonLabel("working")).toBe("Working…");
    expect(sendButtonLabel("failed")).toBe("Retry");
  });
});

/**
 * U6 enhanced-context hand-off (R10/R11): the exact `file:line` is attached to
 * the Send-to-Claude hand-off only when the comment carries a build-time source
 * stamp AND the dashboard "include file:line" toggle is on.
 */
function contextWithSource(sourceFile?: string, sourceLine?: number): CapturedContext {
  return {
    selector: "#el",
    anchors: [],
    url: "https://example.com",
    consoleErrors: [],
    ...(sourceFile
      ? {
          react: {
            componentPath: ["App", "Card"],
            sourceFile,
            ...(sourceLine ? { sourceLine } : {}),
          },
        }
      : {}),
  } as CapturedContext;
}

describe("R10/R11 enhanced-context hand-off (handoffSourceRef)", () => {
  it("includes file:line when source is present and the toggle is on", () => {
    const ctx = contextWithSource("src/components/Card.tsx", 42);
    expect(handoffSourceRef(ctx, true)).toBe("src/components/Card.tsx:42");
  });

  it("includes the file alone when only the file (no line) was stamped", () => {
    const ctx = contextWithSource("src/components/Card.tsx");
    expect(handoffSourceRef(ctx, true)).toBe("src/components/Card.tsx");
  });

  it("omits file:line when the comment has no source stamp (AE7)", () => {
    expect(handoffSourceRef(contextWithSource(), true)).toBeNull();
    expect(handoffSourceRef(null, true)).toBeNull();
  });

  it("withholds file:line when the toggle is off, even when present", () => {
    const ctx = contextWithSource("src/components/Card.tsx", 42);
    expect(handoffSourceRef(ctx, false)).toBeNull();
  });

  it("sourceRefFromContext formats the same way without gating", () => {
    expect(sourceRefFromContext(contextWithSource("a/b.tsx", 7))).toBe("a/b.tsx:7");
    expect(sourceRefFromContext(contextWithSource())).toBeNull();
  });

  it("the enqueue hand-off payload carries the gated source ref", () => {
    // Mirrors the { commentId, confirmGuest, sourceRef } shape the
    // /api/send-to-claude route assembles: present when enabled, null when off.
    const ctx = contextWithSource("src/Card.tsx", 42);
    const on = { commentId: "c1", confirmGuest: false, sourceRef: handoffSourceRef(ctx, true) };
    const off = { commentId: "c1", confirmGuest: false, sourceRef: handoffSourceRef(ctx, false) };
    expect(on.sourceRef).toBe("src/Card.tsx:42");
    expect(off.sourceRef).toBeNull();
  });
});
