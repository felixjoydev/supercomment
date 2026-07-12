import { describe, it, expect } from "vitest";

import { displayLaneOf, laneLabelFor, audienceOf } from "./lane.js";

/**
 * U10 — the overlay's lane projection + audience-aware labels (mirrors the
 * dashboard §2/§5). Pure, no DOM.
 */

describe("displayLaneOf (status + lane projection)", () => {
  it("shows the lane column while open", () => {
    expect(displayLaneOf({ status: "open", lane: "backlog" })).toBe("backlog");
    expect(displayLaneOf({ status: "open", lane: "ready_for_agent" })).toBe("ready_for_agent");
    expect(displayLaneOf({ status: "open", lane: "in_review" })).toBe("in_review");
  });

  it("projects resolved → done and dismissed → dismissed regardless of lane", () => {
    expect(displayLaneOf({ status: "resolved", lane: "in_review" })).toBe("done");
    expect(displayLaneOf({ status: "dismissed", lane: "ready_for_agent" })).toBe("dismissed");
  });

  it("defaults a missing lane/content to backlog", () => {
    expect(displayLaneOf({ status: "open" })).toBe("backlog");
    expect(displayLaneOf(undefined)).toBe("backlog");
  });
});

describe("laneLabelFor (audience-aware, §5)", () => {
  it("member labels are the real pipeline names", () => {
    expect(laneLabelFor("backlog", "member")).toBe("Backlog");
    expect(laneLabelFor("ready_for_agent", "member")).toBe("Ready for agent");
    expect(laneLabelFor("in_review", "member")).toBe("In review");
    expect(laneLabelFor("done", "member")).toBe("Done");
  });

  it("reviewer labels hide the internal pipeline and never say 'agent' or 'guest'", () => {
    expect(laneLabelFor("backlog", "reviewer")).toBe("Open");
    expect(laneLabelFor("ready_for_agent", "reviewer")).toBe("In progress");
    expect(laneLabelFor("in_review", "reviewer")).toBe("Ready for review");
    expect(laneLabelFor("dismissed", "reviewer")).toBe("Closed");
    for (const l of ["backlog", "ready_for_agent", "in_review", "done", "dismissed"] as const) {
      expect(laneLabelFor(l, "reviewer")).not.toMatch(/agent|guest/i);
    }
  });

  it("defaults to member labels", () => {
    expect(laneLabelFor("ready_for_agent")).toBe("Ready for agent");
  });
});

describe("audienceOf", () => {
  it("maps a member role to member, everything else to reviewer", () => {
    expect(audienceOf("member")).toBe("member");
    expect(audienceOf("guest")).toBe("reviewer");
    expect(audienceOf(undefined)).toBe("reviewer");
  });
});
