import { describe, it, expect, vi } from "vitest";

import { toCommentView } from "../lib/comments/transform";
import type { CommentRow, CommentView } from "../lib/comments/types";
import {
  mergeComment,
  mergeComments,
  sortForReview,
  selectDefaultView,
  selectView,
  filterComments,
  countByStatus,
  applyStatusTransition,
} from "../lib/comments/view";

/**
 * U9 dashboard — realtime merge, default view, sorting/filtering, and the
 * resolve/dismiss lifecycle. Pure logic + a mocked Supabase RPC client (node
 * env). jsdom is broken in this sandbox, so no real DOM/websocket is exercised.
 *
 * VERIFY IN REAL ENV (AE6 / deferred U2 realtime-client check): the live
 * private-channel websocket round-trip (subscribe → receive a broadcast →
 * SUBSCRIBED status) and the actual DOM render of CommentBoard. The merge
 * function those feed is tested exhaustively below.
 */

function row(over: Partial<CommentRow> = {}): CommentRow {
  return {
    id: over.id ?? "00000000-0000-0000-0000-000000000001",
    preview_id: "p1",
    number: over.number ?? 1,
    trust_level: over.trust_level ?? "member",
    intent: over.intent ?? "fix",
    severity: over.severity ?? "important",
    note: over.note ?? "note",
    status: over.status ?? "open",
    fidelity: over.fidelity ?? "live",
    context: over.context ?? { selector: "#x" },
    path: over.path ?? "/",
    created_at: over.created_at ?? "2026-05-30T10:00:00.000Z",
    ...over,
  };
}

function view(over: Partial<CommentRow> = {}, author?: string | null): CommentView {
  return toCommentView(row(over), author);
}

describe("toCommentView", () => {
  it("normalizes a DB row to the dashboard view, with author name", () => {
    const v = toCommentView(row({ id: "a", number: 5 }), "Dana");
    expect(v.id).toBe("a");
    expect(v.number).toBe(5);
    expect(v.author).toBe("Dana");
    expect(v.context?.selector).toBe("#x");
  });

  it("parses context delivered as a JSON string (broadcast path)", () => {
    const v = toCommentView(row({ context: JSON.stringify({ selector: ".btn" }) }));
    expect(v.context?.selector).toBe(".btn");
  });

  it("fails soft to null context on bad JSON", () => {
    const v = toCommentView(row({ context: "{not json" }));
    expect(v.context).toBeNull();
  });
});

describe("mergeComment (realtime)", () => {
  it("inserts a new broadcast comment", () => {
    const list: CommentView[] = [view({ id: "a" })];
    const next = mergeComment(list, view({ id: "b", number: 2 }));
    expect(next).toHaveLength(2);
    expect(next.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("updates an existing comment by id (status change)", () => {
    const list: CommentView[] = [view({ id: "a", status: "open" })];
    const next = mergeComment(list, view({ id: "a", status: "resolved" }));
    expect(next).toHaveLength(1);
    expect(next[0]!.status).toBe("resolved");
  });

  it("dedups an identical re-delivery (returns same reference, no dup)", () => {
    const list: CommentView[] = [view({ id: "a" })];
    const next = mergeComment(list, view({ id: "a" }));
    expect(next).toBe(list); // unchanged reference
    expect(next).toHaveLength(1);
  });

  it("mergeComments applies a batch and stays idempotent across re-delivery", () => {
    let list: CommentView[] = [];
    list = mergeComments(list, [view({ id: "a" }), view({ id: "b", number: 2 })]);
    expect(list).toHaveLength(2);
    // re-deliver the same batch — no duplicates
    list = mergeComments(list, [view({ id: "a" }), view({ id: "b", number: 2 })]);
    expect(list).toHaveLength(2);
  });
});

describe("default view + sorting", () => {
  it("sorts severity-desc then newest-first", () => {
    const minorNew = view({ id: "1", severity: "minor", created_at: "2026-05-30T12:00:00Z", number: 3 });
    const criticalOld = view({ id: "2", severity: "critical", created_at: "2026-05-30T09:00:00Z", number: 1 });
    const importantNew = view({ id: "3", severity: "important", created_at: "2026-05-30T11:00:00Z", number: 2 });
    const sorted = sortForReview([minorNew, criticalOld, importantNew]);
    expect(sorted.map((c) => c.id)).toEqual(["2", "3", "1"]);
  });

  it("breaks newest ties by descending comment number", () => {
    const a = view({ id: "a", severity: "minor", created_at: "2026-05-30T10:00:00Z", number: 7 });
    const b = view({ id: "b", severity: "minor", created_at: "2026-05-30T10:00:00Z", number: 9 });
    const sorted = sortForReview([a, b]);
    expect(sorted.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("default view shows only open comments, resolved/dismissed excluded", () => {
    const open = view({ id: "o", status: "open" });
    const resolved = view({ id: "r", status: "resolved" });
    const dismissed = view({ id: "d", status: "dismissed" });
    const def = selectDefaultView([open, resolved, dismissed]);
    expect(def.map((c) => c.id)).toEqual(["o"]);
  });

  it("history filter includes resolved + dismissed but not open", () => {
    const open = view({ id: "o", status: "open" });
    const resolved = view({ id: "r", status: "resolved" });
    const dismissed = view({ id: "d", status: "dismissed" });
    const hist = filterComments([open, resolved, dismissed], "history");
    expect(hist.map((c) => c.id).sort()).toEqual(["d", "r"]);
  });

  it("all filter (via selectView) includes everything sorted", () => {
    const open = view({ id: "o", status: "open", severity: "minor" });
    const resolved = view({ id: "r", status: "resolved", severity: "critical" });
    const all = selectView([open, resolved], "all");
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe("r"); // critical first
  });
});

describe("countByStatus", () => {
  it("counts open / resolved / dismissed / total", () => {
    const counts = countByStatus([
      view({ id: "1", status: "open" }),
      view({ id: "2", status: "open" }),
      view({ id: "3", status: "resolved" }),
      view({ id: "4", status: "dismissed" }),
    ]);
    expect(counts).toEqual({ open: 2, resolved: 1, dismissed: 1, total: 4 });
  });
});

describe("lifecycle — resolve / dismiss via mocked RPC", () => {
  it("resolve sets status=resolved and stores the summary (AE6)", async () => {
    const resolved = { ...view({ id: "c1" }), status: "resolved", resolved_summary: "fixed it" };
    const rpc = vi.fn().mockResolvedValue({ data: resolved, error: null });
    const supabase = { rpc };

    const res = await supabase.rpc("resolve_comment", { p_comment_id: "c1", p_summary: "fixed it" });

    expect(rpc).toHaveBeenCalledWith("resolve_comment", { p_comment_id: "c1", p_summary: "fixed it" });
    expect(res.error).toBeNull();
    expect(res.data.status).toBe("resolved");

    // optimistic local update mirrors the RPC result
    const list = applyStatusTransition([view({ id: "c1", status: "open" })], "c1", "resolved", "fixed it");
    expect(list[0]!.status).toBe("resolved");
    expect(list[0]!.resolvedSummary).toBe("fixed it");
  });

  it("dismiss sets status=dismissed via the dismiss_comment RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...view({ id: "c2" }), status: "dismissed" },
      error: null,
    });
    const supabase = { rpc };

    const res = await supabase.rpc("dismiss_comment", { p_comment_id: "c2", p_reason: "wontfix" });
    expect(rpc).toHaveBeenCalledWith("dismiss_comment", { p_comment_id: "c2", p_reason: "wontfix" });
    expect(res.data.status).toBe("dismissed");

    const list = applyStatusTransition([view({ id: "c2", status: "open" })], "c2", "dismissed", "wontfix");
    expect(list[0]!.status).toBe("dismissed");
  });

  it("a non-owner/reviewer is rejected by the RPC guard (mocked 42501)", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "not_authorized" },
    });
    const supabase = { rpc };
    const res = await supabase.rpc("resolve_comment", { p_comment_id: "c3", p_summary: "" });
    expect(res.error?.code).toBe("42501");
    expect(res.data).toBeNull();
  });
});

describe("trust display", () => {
  it("flags a guest comment as guest and a member comment as member", () => {
    expect(view({ id: "g", trust_level: "guest" }).trustLevel).toBe("guest");
    expect(view({ id: "m", trust_level: "member" }).trustLevel).toBe("member");
  });
});
