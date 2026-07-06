import { describe, it, expect } from "vitest";

import { diffMarkersByNumber } from "./marker-diff.js";
import type { ExistingCommentMarker } from "../core/types.js";

function m(
  number: number,
  content: Partial<ExistingCommentMarker["content"]> = {},
  over: Partial<ExistingCommentMarker> = {},
): ExistingCommentMarker {
  return {
    number,
    rect: null,
    isStale: false,
    anchors: [],
    content: {
      note: `note ${number}`,
      authorDisplayName: "Ada",
      status: "open",
      ...content,
    },
    ...over,
  };
}

describe("diffMarkersByNumber", () => {
  it("flags a comment present in the fresh read but not placed as added", () => {
    const diff = diffMarkersByNumber([m(1)], [m(1), m(2)]);
    expect(diff.added.map((c) => c.number)).toEqual([2]);
    expect(diff.removedNumbers).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  it("flags a placed comment gone from the fresh read as removed (deleted thread)", () => {
    const diff = diffMarkersByNumber([m(1), m(2)], [m(1)]);
    expect(diff.removedNumbers).toEqual([2]);
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  it("is a no-op when nothing the reviewer sees changed", () => {
    const diff = diffMarkersByNumber([m(1), m(2)], [m(1), m(2)]);
    expect(diff.added).toEqual([]);
    expect(diff.removedNumbers).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  it("flags a status change (marked done elsewhere) as updated", () => {
    const diff = diffMarkersByNumber(
      [m(1, { status: "open" })],
      [m(1, { status: "resolved" })],
    );
    expect(diff.updated.map((c) => c.number)).toEqual([1]);
    expect(diff.updated[0]!.content.status).toBe("resolved");
  });

  it("flags a note edit and a stale-ness change as updated", () => {
    expect(
      diffMarkersByNumber([m(1, { note: "a" })], [m(1, { note: "b" })]).updated,
    ).toHaveLength(1);
    expect(
      diffMarkersByNumber([m(1, {}, { isStale: false })], [m(1, {}, { isStale: true })])
        .updated,
    ).toHaveLength(1);
  });

  it("does NOT flag an unrelated field (e.g. author) as a visible update", () => {
    const diff = diffMarkersByNumber(
      [m(1, { authorDisplayName: "Ada" })],
      [m(1, { authorDisplayName: "Grace" })],
    );
    expect(diff.updated).toEqual([]);
  });

  it("handles simultaneous add + remove + update in one diff", () => {
    const prev = [m(1, { status: "open" }), m(2), m(3)];
    const next = [m(1, { status: "resolved" }), m(3), m(4)];
    const diff = diffMarkersByNumber(prev, next);
    expect(diff.added.map((c) => c.number)).toEqual([4]);
    expect(diff.removedNumbers).toEqual([2]);
    expect(diff.updated.map((c) => c.number)).toEqual([1]);
  });
});
