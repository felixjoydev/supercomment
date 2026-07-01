import { describe, it, expect } from "vitest";

import type { EditTarget, VisualChangeSet } from "@supercomment/shared";

import { makeFakeDom, type FakeElement } from "../test/dom-double.js";
import {
  applyChangeSet,
  ModifiedViewController,
  type ApplyOptions,
} from "./apply-change-set.js";

function target(selector: string): EditTarget {
  return { selector, anchors: [] };
}

function textOp(
  selector: string,
  before: string,
  after: string,
  opId = "o",
): VisualChangeSet["ops"][number] {
  return { opId, type: "setText", target: target(selector), before, after };
}

/** Resolve op targets to fake elements by selector, bypassing reanchor. */
function resolverFor(
  map: Record<string, FakeElement>,
): ApplyOptions["resolve"] {
  return (t) => (map[t.selector] as unknown as Element) ?? null;
}

function leaf(
  doc: ReturnType<typeof makeFakeDom>["doc"],
  tag: string,
  text: string,
): FakeElement {
  const el = doc.createElement(tag);
  el.textContent = text;
  doc.body.appendChild(el);
  return el;
}

describe("applyChangeSet — opt-in modified view (R5/R6)", () => {
  it("applies a text edit and reverts to the exact live build (AE1)", () => {
    const { doc } = makeFakeDom();
    const h1 = leaf(doc, "h1", "Welcome");
    const cs: VisualChangeSet = { ops: [textOp("h1", "Welcome", "Get started")] };

    const result = applyChangeSet(cs, doc as unknown as Document, {
      resolve: resolverFor({ h1 }),
    });

    expect(result.applied).toBe(1);
    expect(result.stale).toBe(false);
    expect(h1.textContent).toBe("Get started");

    result.revert();
    expect(h1.textContent).toBe("Welcome");
  });

  it("refuses to re-apply a change-set authored against a different build (drift, G8/G10)", () => {
    const { doc } = makeFakeDom();
    const h1 = leaf(doc, "h1", "Welcome");
    const cs: VisualChangeSet = {
      authoredCommit: "aaaaaaa",
      ops: [textOp("h1", "Welcome", "Changed")],
    };

    const result = applyChangeSet(cs, doc as unknown as Document, {
      pageCommit: "bbbbbbb",
      resolve: resolverFor({ h1 }),
    });

    expect(result.stale).toBe(true);
    expect(result.applied).toBe(0);
    expect(h1.textContent).toBe("Welcome"); // untouched — caller shows the screenshot
  });

  it("applies when commits match, and skips ops whose target can't be resolved", () => {
    const { doc } = makeFakeDom();
    const h1 = leaf(doc, "h1", "Welcome");
    const cs: VisualChangeSet = {
      authoredCommit: "same",
      ops: [
        textOp("h1", "Welcome", "Hi", "o1"),
        textOp("gone", "X", "Y", "o2"),
      ],
    };
    const result = applyChangeSet(cs, doc as unknown as Document, {
      pageCommit: "same",
      resolve: resolverFor({ h1 }),
    });
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(h1.textContent).toBe("Hi");
  });

  it("counts a style op as applied and reverts without throwing", () => {
    const { doc } = makeFakeDom();
    const h1 = leaf(doc, "h1", "Welcome");
    const cs: VisualChangeSet = {
      ops: [
        {
          opId: "s",
          type: "setStyle",
          target: target("h1"),
          property: "color",
          before: "black",
          after: "red",
        },
      ],
    };
    const result = applyChangeSet(cs, doc as unknown as Document, {
      resolve: resolverFor({ h1 }),
    });
    expect(result.applied).toBe(1);
    expect(() => result.revert()).not.toThrow();
  });

  it("re-asserts the preview after the framework clobbers it", () => {
    const { doc } = makeFakeDom();
    const h1 = leaf(doc, "h1", "Welcome");
    const result = applyChangeSet(
      { ops: [textOp("h1", "Welcome", "Preview")] },
      doc as unknown as Document,
      { resolve: resolverFor({ h1 }) },
    );
    expect(h1.textContent).toBe("Preview");

    h1.textContent = "reverted-by-host-framework";
    result.reassert();
    expect(h1.textContent).toBe("Preview");
  });
});

describe("ModifiedViewController — single active (G7)", () => {
  it("selecting another template reverts the first, then applies the second", () => {
    const { doc } = makeFakeDom();
    const h1 = leaf(doc, "h1", "Original");
    const mvc = new ModifiedViewController(doc as unknown as Document, {
      resolve: resolverFor({ h1 }),
    });

    mvc.select("tplA", { ops: [textOp("h1", "Original", "View A")] });
    expect(h1.textContent).toBe("View A");
    expect(mvc.activeId()).toBe("tplA");

    mvc.select("tplB", { ops: [textOp("h1", "View A", "View B")] });
    expect(h1.textContent).toBe("View B"); // A was reverted first, B applied
    expect(mvc.activeId()).toBe("tplB");

    mvc.deselect();
    expect(h1.textContent).toBe("Original"); // live build restored
    expect(mvc.activeId()).toBeNull();
  });

  it("re-selecting the active template is a no-op (same result, no double-apply)", () => {
    const { doc } = makeFakeDom();
    const h1 = leaf(doc, "h1", "Original");
    const mvc = new ModifiedViewController(doc as unknown as Document, {
      resolve: resolverFor({ h1 }),
    });
    const r1 = mvc.select("tplA", { ops: [textOp("h1", "Original", "Modified")] });
    const r2 = mvc.select("tplA", { ops: [textOp("h1", "Original", "Modified")] });
    expect(r1).toBe(r2);
    expect(h1.textContent).toBe("Modified");
  });

  it("does not apply a drifted template (caller falls back to the screenshot)", () => {
    const { doc } = makeFakeDom();
    const h1 = leaf(doc, "h1", "Original");
    const mvc = new ModifiedViewController(doc as unknown as Document, {
      resolve: resolverFor({ h1 }),
      pageCommit: "current",
    });
    const result = mvc.select("tpl", {
      authoredCommit: "old",
      ops: [textOp("h1", "Original", "Nope")],
    });
    expect(result.stale).toBe(true);
    expect(h1.textContent).toBe("Original");
    expect(mvc.activeId()).toBeNull(); // nothing became active
  });
});
