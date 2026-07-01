import { describe, it, expect } from "vitest";

import type { ReactContext } from "@supercomment/shared";

import {
  SOURCE_STAMP_ATTR,
  parseSourceStamp,
  captureSourceStamp,
  mergeSourceStamp,
} from "./source.js";

/**
 * A lightweight Element double exposing only `closest` + `getAttribute`, so the
 * read path is exercised in the `node` environment too (jsdom is not always
 * loadable in this sandbox — see vitest.config.ts).
 */
function elementWithStamp(stampValue: string | null): Element {
  const stamped =
    stampValue === null
      ? null
      : {
          getAttribute: (name: string): string | null =>
            name === SOURCE_STAMP_ATTR ? stampValue : null,
        };
  return {
    closest: (selector: string): unknown =>
      selector === `[${SOURCE_STAMP_ATTR}]` ? stamped : null,
  } as unknown as Element;
}

describe("parseSourceStamp", () => {
  it("parses file:line:col", () => {
    expect(parseSourceStamp("src/components/Card.tsx:42:6")).toEqual({
      file: "src/components/Card.tsx",
      line: 42,
      column: 6,
    });
  });

  it("parses file:line (no column)", () => {
    expect(parseSourceStamp("src/App.tsx:7")).toEqual({
      file: "src/App.tsx",
      line: 7,
    });
  });

  it("preserves colons inside the path (line/col peeled from the right)", () => {
    expect(parseSourceStamp("a:b/weird.tsx:10:2")).toEqual({
      file: "a:b/weird.tsx",
      line: 10,
      column: 2,
    });
  });

  it("returns a file-only stamp when there is no numeric tail", () => {
    expect(parseSourceStamp("just/a/path.tsx")).toEqual({
      file: "just/a/path.tsx",
    });
  });

  it("returns null for an empty value", () => {
    expect(parseSourceStamp("   ")).toBeNull();
  });
});

describe("captureSourceStamp", () => {
  it("reads the nearest stamp via closest() and parses it", () => {
    const el = elementWithStamp("src/Widget.tsx:3:1");
    expect(captureSourceStamp(el)).toEqual({
      file: "src/Widget.tsx",
      line: 3,
      column: 1,
    });
  });

  it("returns null when no ancestor carries the attribute", () => {
    expect(captureSourceStamp(elementWithStamp(null))).toBeNull();
  });

  it("returns null (no throw) when closest() throws", () => {
    const el = {
      closest: () => {
        throw new Error("boom");
      },
    } as unknown as Element;
    expect(captureSourceStamp(el)).toBeNull();
  });

  it("returns null when the attribute is present but empty", () => {
    expect(captureSourceStamp(elementWithStamp(""))).toBeNull();
  });
});

describe("mergeSourceStamp", () => {
  it("populates sourceFile/sourceLine/sourceColumn on a React context", () => {
    const react: ReactContext = { componentPath: ["App", "Card"] };
    const merged = mergeSourceStamp(react, {
      file: "src/Card.tsx",
      line: 42,
      column: 6,
    });
    expect(merged).toEqual({
      componentPath: ["App", "Card"],
      sourceFile: "src/Card.tsx",
      sourceLine: 42,
      sourceColumn: 6,
    });
  });

  it("persists column 0 (0-based) alongside the line", () => {
    const react: ReactContext = { componentPath: ["App"] };
    const merged = mergeSourceStamp(react, { file: "x.tsx", line: 3, column: 0 });
    expect(merged?.sourceColumn).toBe(0);
  });

  it("omits sourceColumn when the stamp has a line but no column", () => {
    const react: ReactContext = { componentPath: ["App"] };
    const merged = mergeSourceStamp(react, { file: "x.tsx", line: 9 });
    expect(merged?.sourceLine).toBe(9);
    expect(merged?.sourceColumn).toBeUndefined();
  });

  it("clears a stale sourceColumn when re-merging a file-only stamp", () => {
    const react: ReactContext = {
      componentPath: ["App"],
      sourceFile: "stale.tsx",
      sourceLine: 5,
      sourceColumn: 2,
    };
    const merged = mergeSourceStamp(react, { file: "fresh.tsx" });
    expect(merged?.sourceLine).toBeUndefined();
    expect(merged?.sourceColumn).toBeUndefined();
  });

  it("overrides any fiber-derived source (stamp is authoritative)", () => {
    const react: ReactContext = {
      componentPath: ["App"],
      sourceFile: "stale.tsx",
      sourceLine: 1,
    };
    const merged = mergeSourceStamp(react, { file: "fresh.tsx", line: 9 });
    expect(merged?.sourceFile).toBe("fresh.tsx");
    expect(merged?.sourceLine).toBe(9);
  });

  it("sets file but clears line for a file-only stamp", () => {
    const react: ReactContext = {
      componentPath: ["App"],
      sourceFile: "stale.tsx",
      sourceLine: 5,
    };
    const merged = mergeSourceStamp(react, { file: "fresh.tsx" });
    expect(merged?.sourceFile).toBe("fresh.tsx");
    expect(merged?.sourceLine).toBeUndefined();
  });

  it("falls back to the component-path capture when the stamp is absent", () => {
    const react: ReactContext = { componentPath: ["App", "Widget"] };
    expect(mergeSourceStamp(react, null)).toEqual({
      componentPath: ["App", "Widget"],
    });
  });

  it("returns null unchanged when there is no React context (no throw)", () => {
    expect(mergeSourceStamp(null, { file: "x.tsx", line: 1 })).toBeNull();
    expect(mergeSourceStamp(null, null)).toBeNull();
  });
});
