import { describe, it, expect } from "vitest";

import { hasEnhancedContext } from "../lib/comments/handoff";
import type { CommentView } from "../lib/comments/types";
import type { CapturedContext } from "@supercomment/shared";

/**
 * U6 enhanced-context auto-detection (R10). Pure, node-env: the dashboard panel
 * reports "detected" when ANY of a preview's comments carries a build-time
 * `file:line` source stamp (`context.react.sourceFile`, stamped by U5).
 */
function contextWithSource(sourceFile?: string): CapturedContext {
  return {
    selector: "#el",
    anchors: [],
    url: "https://example.com",
    consoleErrors: [],
    ...(sourceFile ? { react: { componentPath: ["Card"], sourceFile } } : {}),
  } as CapturedContext;
}

function comment(context: CapturedContext | null): Pick<CommentView, "context"> {
  return { context };
}

describe("hasEnhancedContext", () => {
  it("detects when any comment carries a source stamp", () => {
    expect(
      hasEnhancedContext([comment(null), comment(contextWithSource("src/Card.tsx"))]),
    ).toBe(true);
  });

  it("not detected when no comment carries file:line", () => {
    expect(hasEnhancedContext([comment(null), comment(contextWithSource())])).toBe(false);
  });

  it("not detected for an empty comment list", () => {
    expect(hasEnhancedContext([])).toBe(false);
  });
});
