import { describe, it, expect } from "vitest";

import { a11yNodeSchema } from "@supercomment/shared";

import { captureA11yTree, describeNode } from "./a11y.js";
import { buildDom, byTag } from "./test-dom.js";

describe("captureA11yTree", () => {
  it("captures the target plus ancestors (target first), capped at 5", () => {
    const { root } = buildDom({
      tag: "body",
      children: [
        {
          tag: "main",
          children: [
            {
              tag: "form",
              id: "checkout",
              children: [
                {
                  tag: "button",
                  attrs: { class: "btn primary", "aria-label": "Buy now" },
                  text: "Buy",
                },
              ],
            },
          ],
        },
      ],
    });
    const button = byTag(root, "button");

    const tree = captureA11yTree(button as unknown as Element);
    expect(tree).not.toBeNull();
    // target first
    expect(tree?.[0]?.tagName).toBe("button");
    expect(tree?.[0]?.name).toBe("Buy now");
    expect(tree?.[0]?.className).toBe("btn primary");
    // ancestors follow
    expect(tree?.map((n) => n.tagName)).toEqual([
      "button",
      "form",
      "main",
      "body",
    ]);
    expect(tree?.find((n) => n.tagName === "form")?.id).toBe("checkout");
    // depth cap
    expect((tree ?? []).length).toBeLessThanOrEqual(5);
    // schema-valid
    for (const node of tree ?? []) {
      expect(() => a11yNodeSchema.parse(node)).not.toThrow();
    }
  });

  it("returns null for a null element", () => {
    expect(captureA11yTree(null)).toBeNull();
  });

  it("redacts secrets/PII in the accessible name", () => {
    const { root } = buildDom({
      tag: "div",
      attrs: { title: "Contact admin@example.com now" },
    });
    const node = describeNode(root as unknown as Element);
    expect(node?.name).toContain("[redacted]");
    expect(node?.name).not.toContain("admin@example.com");
  });
});
