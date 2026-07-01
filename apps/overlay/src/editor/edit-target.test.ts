import { describe, it, expect } from "vitest";

import { editTargetSchema } from "@supercomment/shared";

import { makeFakeDom, type FakeElement } from "../test/dom-double.js";
import { buildEditTarget } from "./edit-target.js";

describe("buildEditTarget", () => {
  it("assembles a selector + anchors and marks source unknown on an unstamped host", () => {
    const { doc } = makeFakeDom();
    const el = doc.createElement("button");
    el.setAttribute("id", "cta");
    el.textContent = "Buy now";
    doc.body.appendChild(el);

    const target = buildEditTarget(
      el as unknown as Element,
      doc as unknown as Document,
    );

    expect(target.selector.length).toBeGreaterThan(0);
    expect(Array.isArray(target.anchors)).toBe(true);
    // No data-sc-source stamp → the agent must NOT be handed a fabricated file.
    expect(target.source).toBeUndefined();
    expect(target.sourceUnknown).toBe(true);
    // The id anchor is captured for robust re-resolution.
    expect(target.anchors.some((a) => a.type === "id" && a.value === "cta")).toBe(true);
  });

  it("populates source {file,line,column} from a build-time data-sc-source stamp", () => {
    const { doc } = makeFakeDom();
    const el = doc.createElement("h1") as FakeElement & {
      closest: (s: string) => FakeElement | null;
    };
    el.setAttribute("data-sc-source", "src/components/Hero.tsx:12:4");
    // The fake's closest only matches tag/class/id; resolve the stamp explicitly.
    el.closest = (sel: string) => (sel.includes("data-sc-source") ? el : null);
    doc.body.appendChild(el);

    const target = buildEditTarget(
      el as unknown as Element,
      doc as unknown as Document,
    );

    expect(target.source).toEqual({
      file: "src/components/Hero.tsx",
      line: 12,
      column: 4,
    });
    expect(target.sourceUnknown).toBeUndefined();
  });

  it("produces a schema-valid EditTarget", () => {
    const { doc } = makeFakeDom();
    const el = doc.createElement("div");
    doc.body.appendChild(el);
    const target = buildEditTarget(
      el as unknown as Element,
      doc as unknown as Document,
    );
    expect(() => editTargetSchema.parse(target)).not.toThrow();
  });
});
