import { describe, it, expect } from "vitest";
import {
  displayLane,
  matchesLaneFilter,
  filterByLane,
  countByLane,
  needsReview,
  isClosed,
  applyLaneTransition,
  mergeComment,
} from "../lib/comments/view";
import { laneLabel } from "../lib/comments/labels";
import type { CommentView } from "../lib/comments/types";
import type { CommentLane, CommentStatus } from "@supercomment/shared";

/**
 * U6 — the workflow-lane projection + filter + counts + optimistic transition,
 * and the audience-aware labels. Pure logic, node env.
 */

function mk(over: Partial<CommentView> & { id: string }): CommentView {
  return {
    previewId: "p1",
    number: 1,
    author: null,
    authorParticipant: null,
    trustLevel: "member",
    intent: "fix",
    severity: "minor",
    note: "n",
    status: "open",
    fidelity: "live",
    kind: "comment",
    lane: "backlog",
    reviewSummary: null,
    isStale: false,
    context: null,
    path: null,
    resolvedSummary: null,
    createdAt: "2026-07-12T10:00:00.000Z",
    statusChangedAt: "2026-07-12T10:00:00.000Z",
    sendStatus: null,
    pageKey: "/",
    pageLabel: "Home",
    authorEmail: null,
    latestReplyAt: null,
    lastReadAt: null,
    unread: false,
    privatePrompt: null,
    ...over,
  };
}

const laneComment = (id: string, lane: CommentLane, status: CommentStatus = "open") =>
  mk({ id, lane, status });

describe("displayLane (§2 projection: lane can never disagree with status)", () => {
  it("shows the lane column for an OPEN comment", () => {
    expect(displayLane(mk({ id: "a", lane: "backlog" }))).toBe("backlog");
    expect(displayLane(mk({ id: "b", lane: "ready_for_agent" }))).toBe("ready_for_agent");
    expect(displayLane(mk({ id: "c", lane: "in_review" }))).toBe("in_review");
  });

  it("shows 'done' for a resolved comment regardless of its lane column", () => {
    expect(displayLane(mk({ id: "a", status: "resolved", lane: "in_review" }))).toBe("done");
    expect(displayLane(mk({ id: "b", status: "resolved", lane: "backlog" }))).toBe("done");
  });

  it("shows 'dismissed' for a dismissed comment regardless of its lane column", () => {
    expect(displayLane(mk({ id: "a", status: "dismissed", lane: "ready_for_agent" }))).toBe("dismissed");
  });
});

describe("matchesLaneFilter / filterByLane", () => {
  const list: CommentView[] = [
    laneComment("bk", "backlog"),
    laneComment("rf", "ready_for_agent"),
    laneComment("ir", "in_review"),
    mk({ id: "dn", status: "resolved" }),
    mk({ id: "di", status: "dismissed" }),
  ];

  it("'all' matches everything except dismissed", () => {
    expect(filterByLane(list, "all").map((c) => c.id)).toEqual(["bk", "rf", "ir", "dn"]);
  });

  it("each lane filter selects exactly its display lane", () => {
    expect(filterByLane(list, "backlog").map((c) => c.id)).toEqual(["bk"]);
    expect(filterByLane(list, "ready_for_agent").map((c) => c.id)).toEqual(["rf"]);
    expect(filterByLane(list, "in_review").map((c) => c.id)).toEqual(["ir"]);
    expect(filterByLane(list, "done").map((c) => c.id)).toEqual(["dn"]);
    expect(filterByLane(list, "dismissed").map((c) => c.id)).toEqual(["di"]);
  });

  it("matchesLaneFilter is consistent with displayLane", () => {
    expect(matchesLaneFilter(laneComment("x", "in_review"), "in_review")).toBe(true);
    expect(matchesLaneFilter(laneComment("x", "in_review"), "backlog")).toBe(false);
  });
});

describe("countByLane", () => {
  it("counts each display lane and rolls 'all' up as everything-not-dismissed", () => {
    const counts = countByLane([
      laneComment("a", "backlog"),
      laneComment("b", "backlog"),
      laneComment("c", "ready_for_agent"),
      laneComment("d", "in_review"),
      mk({ id: "e", status: "resolved" }),
      mk({ id: "f", status: "dismissed" }),
    ]);
    expect(counts).toEqual({
      all: 5, // backlog(2) + ready(1) + in_review(1) + done(1), NOT dismissed
      backlog: 2,
      ready_for_agent: 1,
      in_review: 1,
      done: 1,
      dismissed: 1,
    });
  });
});

describe("needsReview / isClosed", () => {
  it("needsReview is true only for in_review (reviewer's 'needs my review')", () => {
    expect(needsReview(laneComment("a", "in_review"))).toBe(true);
    expect(needsReview(laneComment("a", "backlog"))).toBe(false);
    expect(needsReview(mk({ id: "a", status: "resolved" }))).toBe(false);
  });

  it("isClosed is true for resolved OR dismissed", () => {
    expect(isClosed(mk({ id: "a", status: "resolved" }))).toBe(true);
    expect(isClosed(mk({ id: "a", status: "dismissed" }))).toBe(true);
    expect(isClosed(mk({ id: "a", status: "open" }))).toBe(false);
  });
});

describe("applyLaneTransition (optimistic move)", () => {
  it("moves a comment's lane and returns a new array", () => {
    const list = [laneComment("a", "backlog"), laneComment("b", "backlog")];
    const next = applyLaneTransition(list, "a", "ready_for_agent");
    expect(next).not.toBe(list);
    expect(next.find((c) => c.id === "a")?.lane).toBe("ready_for_agent");
    expect(next.find((c) => c.id === "b")?.lane).toBe("backlog");
  });

  it("carries a review summary when promoting to in_review, preserving it on null", () => {
    const list = [laneComment("a", "ready_for_agent")];
    const promoted = applyLaneTransition(list, "a", "in_review", "raised the CTA");
    expect(promoted[0]!.lane).toBe("in_review");
    expect(promoted[0]!.reviewSummary).toBe("raised the CTA");
    // A later move without a summary must not wipe the recorded one.
    const kicked = applyLaneTransition(promoted, "a", "ready_for_agent");
    expect(kicked[0]!.reviewSummary).toBe("raised the CTA");
  });

  it("is a no-op for an unknown id (same reference)", () => {
    const list = [laneComment("a", "backlog")];
    expect(applyLaneTransition(list, "zzz", "in_review")).toBe(list);
  });
});

describe("mergeComment re-renders on a lane-only change (shallowEqualComment)", () => {
  it("returns a NEW array when only the lane differs", () => {
    const before = [laneComment("a", "backlog")];
    const after = mergeComment(before, laneComment("a", "ready_for_agent"));
    expect(after).not.toBe(before);
    expect(after[0]!.lane).toBe("ready_for_agent");
  });

  it("returns the SAME array when nothing changed (idempotent re-delivery)", () => {
    const before = [laneComment("a", "in_review")];
    const after = mergeComment(before, laneComment("a", "in_review"));
    expect(after).toBe(before);
  });
});

describe("laneLabel (audience-aware, §5)", () => {
  it("member labels are the real pipeline names", () => {
    expect(laneLabel("backlog", "member")).toBe("Backlog");
    expect(laneLabel("ready_for_agent", "member")).toBe("Ready for agent");
    expect(laneLabel("in_review", "member")).toBe("In review");
    expect(laneLabel("done", "member")).toBe("Done");
    expect(laneLabel("dismissed", "member")).toBe("Dismissed");
  });

  it("reviewer labels hide the internal lanes", () => {
    expect(laneLabel("backlog", "reviewer")).toBe("Open");
    expect(laneLabel("ready_for_agent", "reviewer")).toBe("In progress");
    expect(laneLabel("in_review", "reviewer")).toBe("Ready for review");
    expect(laneLabel("done", "reviewer")).toBe("Done");
    expect(laneLabel("dismissed", "reviewer")).toBe("Closed");
  });

  it("defaults to member labels", () => {
    expect(laneLabel("ready_for_agent")).toBe("Ready for agent");
  });

  it("never labels ready_for_agent as anything a reviewer would read as 'agent'", () => {
    // §5 guarantee: the reviewer never sees the agent-facing vocabulary.
    expect(laneLabel("ready_for_agent", "reviewer")).not.toMatch(/agent/i);
  });
});
