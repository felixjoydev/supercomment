import { describe, it, expect } from "vitest";

import type { CapturedContext } from "./schema.js";
import {
  detectConcerns,
  curateContextForAgent,
  summarizeChangeSet,
  summarizeContextSignals,
} from "./relevance.js";

function ctx(overrides: Partial<CapturedContext> = {}): CapturedContext {
  return {
    selector: "button.cta",
    anchors: [],
    url: "https://app.example.com/x",
    consoleErrors: [],
    computedStyles: { color: "red" },
    a11yTree: [{ tagName: "button" }],
    networkRequests: [{ url: "https://api.example.com/x" }],
    interactionTrail: [
      { type: "click", target: "button", timestamp: "2026-06-30T00:00:00.000Z" },
    ],
    appState: { localStorageKeys: ["cart"], sessionStorageKeys: [] },
    environment: { userAgent: "UA" },
    screenshot: "data:image/png;base64,xxx",
    commit: "abc1234",
    react: { componentPath: ["Cta"], sourceFile: "Cta.tsx", sourceLine: 10 },
    ...overrides,
  };
}

describe("detectConcerns", () => {
  it("classifies behavioral / visual / state / perf / browser notes", () => {
    expect(detectConcerns({ note: "the button doesn't work" }).has("behavioral")).toBe(true);
    expect(detectConcerns({ note: "the spacing and color look off" }).has("visual")).toBe(true);
    expect(detectConcerns({ note: "I get logged out after refresh" }).has("state")).toBe(true);
    expect(detectConcerns({ note: "this page is really slow to load" }).has("perf")).toBe(true);
    expect(detectConcerns({ note: "broken on Safari" }).has("browser")).toBe(true);
  });
  it("returns empty for an unclassifiable note", () => {
    expect(detectConcerns({ note: "make this nicer please" }).size).toBe(0);
  });
});

describe("curateContextForAgent", () => {
  it("always keeps the decisive core", () => {
    const c = curateContextForAgent(ctx(), { note: "anything" })!;
    expect(c.selector).toBe("button.cta");
    expect(c.screenshot).toBeTruthy();
    expect(c.commit).toBe("abc1234");
    expect(c.react?.sourceFile).toBe("Cta.tsx");
  });

  it("a visual comment keeps styles/a11y, drops runtime enrichment", () => {
    const c = curateContextForAgent(ctx(), { note: "the color is wrong" })!;
    expect(c.computedStyles).toBeDefined();
    expect(c.a11yTree).toBeDefined();
    expect(c.networkRequests).toBeUndefined();
    expect(c.interactionTrail).toBeUndefined();
    expect(c.appState).toBeUndefined();
    expect(c.environment).toBeUndefined();
  });

  it("a behavioral comment keeps network/trail/appState", () => {
    const c = curateContextForAgent(ctx(), { note: "the submit button doesn't work" })!;
    expect(c.networkRequests).toBeDefined();
    expect(c.interactionTrail).toBeDefined();
    expect(c.appState).toBeDefined();
    // styles dropped for a purely behavioral comment (has exact source line)
    expect(c.computedStyles).toBeUndefined();
  });

  it("keeps network when the runtime already logged a console error, even for a visual comment", () => {
    const c = curateContextForAgent(
      ctx({ consoleErrors: [{ level: "error", message: "boom" }] }),
      { note: "the color is wrong" },
    )!;
    expect(c.networkRequests).toBeDefined();
  });

  it("keeps environment only for browser/device comments", () => {
    expect(curateContextForAgent(ctx(), { note: "broken on mobile" })!.environment).toBeDefined();
    expect(curateContextForAgent(ctx(), { note: "the color is wrong" })!.environment).toBeUndefined();
  });

  it("general (unclassified) keeps visual defaults, drops behavioral enrichment", () => {
    const c = curateContextForAgent(ctx(), { note: "make this nicer" })!;
    expect(c.computedStyles).toBeDefined();
    expect(c.a11yTree).toBeDefined();
    expect(c.networkRequests).toBeUndefined();
    expect(c.interactionTrail).toBeUndefined();
  });

  it("does not mutate the input", () => {
    const original = ctx();
    curateContextForAgent(original, { note: "the color is wrong" });
    expect(original.networkRequests).toBeDefined();
  });

  it("a mobile-surface comment keeps styles/a11y/environment even for a terse note", () => {
    const c = curateContextForAgent(ctx({ surface: "mobile" }), {
      note: "fix this",
    })!;
    expect(c.computedStyles).toBeDefined();
    expect(c.a11yTree).toBeDefined();
    expect(c.environment).toBeDefined();
  });
});

describe("summarizeContextSignals", () => {
  it("lists every present signal", () => {
    const s = summarizeContextSignals(ctx());
    expect(s).toContain("source: Cta.tsx:10");
    expect(s).toContain("commit: abc1234");
    expect(s).toContain("network: 1 request(s)");
    expect(s).toContain("actions: 1");
    expect(s).toContain("storage: 1 key(s)");
    expect(s).toContain("a11y: 1 node(s)");
    expect(s).toContain("screenshot");
    expect(s).toContain("environment");
  });
  it("includes the surface + size when present", () => {
    const s = summarizeContextSignals(
      ctx({ surface: "mobile", viewport: { width: 375, height: 812 } }),
    );
    expect(s).toContain("surface: mobile (375×812)");
  });
  it("reports none for an empty context", () => {
    expect(
      summarizeContextSignals({
        selector: "x",
        anchors: [],
        url: "https://x",
        consoleErrors: [],
      }),
    ).toBe("none");
  });

  it("notes a change-set's edit count in the signals inventory", () => {
    const context: CapturedContext = {
      selector: "x",
      anchors: [],
      url: "https://x",
      consoleErrors: [],
      changeSet: {
        ops: [
          { opId: "o1", type: "setStyle", target: { selector: "h1", anchors: [] }, property: "color", before: "black", after: "red" },
          { opId: "o2", type: "setText", target: { selector: "h1", anchors: [] }, before: "A", after: "B" },
        ],
      },
    };
    expect(summarizeContextSignals(context)).toContain("change-set: 2 edit(s)");
  });
});

describe("summarizeChangeSet (U16, R14)", () => {
  it("renders style + insert ops as deterministic prose", () => {
    const context: CapturedContext = {
      selector: "x",
      anchors: [],
      url: "https://x",
      consoleErrors: [],
      changeSet: {
        ops: [
          {
            opId: "o1",
            type: "setStyle",
            target: {
              selector: "h1.hero",
              anchors: [],
              source: { file: "src/Hero.tsx", line: 12, column: 4 },
            },
            property: "font-size",
            before: "32px",
            after: "48px",
          },
          {
            opId: "o2",
            type: "insertNode",
            target: { selector: "section#hero", anchors: [] },
            insertion: {
              position: "after",
              reference: { selector: "h1.hero", anchors: [] },
            },
            node: { tag: "button", text: "Buy" },
          },
        ],
      },
    };
    const prose = summarizeChangeSet(context);
    expect(prose).toContain("font-size 32px→48px on src/Hero.tsx:12");
    expect(prose).toContain('insert <button> "Buy" after h1.hero');
    expect(prose).toContain("; "); // ops joined
  });

  it("returns null when there is no change-set", () => {
    expect(
      summarizeChangeSet({
        selector: "x",
        anchors: [],
        url: "https://x",
        consoleErrors: [],
      }),
    ).toBeNull();
    expect(summarizeChangeSet(null)).toBeNull();
  });
});
