import { describe, it, expect } from "vitest";

import type { CapturedContext } from "./schema.js";
import { sourceRefFromContext } from "./source-ref.js";

function contextWithSource(file?: string, line?: number): CapturedContext {
  return {
    selector: "x",
    anchors: [],
    url: "https://x",
    consoleErrors: [],
    ...(file ? { react: { componentPath: ["X"], sourceFile: file, sourceLine: line } } : {}),
  };
}

describe("sourceRefFromContext", () => {
  it("formats file:line when both are present", () => {
    expect(sourceRefFromContext(contextWithSource("src/components/Card.tsx", 42))).toBe(
      "src/components/Card.tsx:42",
    );
  });

  it("formats file alone when only the file is known", () => {
    expect(sourceRefFromContext(contextWithSource("src/components/Card.tsx"))).toBe(
      "src/components/Card.tsx",
    );
  });

  it("returns null when there is no source stamp", () => {
    expect(sourceRefFromContext(contextWithSource())).toBeNull();
    expect(sourceRefFromContext(null)).toBeNull();
    expect(sourceRefFromContext(undefined)).toBeNull();
  });
});
