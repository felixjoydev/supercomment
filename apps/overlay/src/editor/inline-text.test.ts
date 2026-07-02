import { describe, it, expect } from "vitest";

import { beginInlineTextEdit, isEditableTextLeaf } from "./inline-text.js";
import { makeFakeDom, type FakeDocument, type FakeElement } from "../test/dom-double.js";

function leaf(doc: FakeDocument, tag: string, text: string): FakeElement {
  const el = doc.createElement(tag);
  el.textContent = text;
  doc.body.appendChild(el);
  return el;
}

describe("isEditableTextLeaf", () => {
  it("accepts a leaf with visible text", () => {
    const { doc } = makeFakeDom();
    expect(isEditableTextLeaf(leaf(doc, "h2", "Pricing") as unknown as Element)).toBe(true);
  });

  it("rejects an element with child elements (would clobber structure)", () => {
    const { doc } = makeFakeDom();
    const div = doc.createElement("div");
    div.appendChild(doc.createElement("span"));
    expect(isEditableTextLeaf(div as unknown as Element)).toBe(false);
  });

  it("rejects an empty leaf", () => {
    const { doc } = makeFakeDom();
    expect(isEditableTextLeaf(leaf(doc, "p", "   ") as unknown as Element)).toBe(false);
  });
});

describe("beginInlineTextEdit", () => {
  it("returns null and records nothing for a non-leaf", () => {
    const { doc } = makeFakeDom();
    const div = doc.createElement("div");
    div.appendChild(doc.createElement("span"));
    let committed = false;
    const handle = beginInlineTextEdit(div as unknown as Element, doc as unknown as Document, {
      onCommit: () => {
        committed = true;
      },
    });
    expect(handle).toBeNull();
    expect(committed).toBe(false);
  });

  it("makes the element editable and commits the new text on blur", () => {
    const { doc } = makeFakeDom();
    const el = leaf(doc, "h1", "Old");
    let result: { before: string; after: string } | null = null;
    beginInlineTextEdit(el as unknown as Element, doc as unknown as Document, {
      onCommit: (before, after) => {
        result = { before, after };
      },
    });
    expect(el.getAttribute("contenteditable")).toBe("plaintext-only");
    el.textContent = "New copy";
    el.dispatch("blur", {});
    expect(result).toEqual({ before: "Old", after: "New copy" });
  });

  it("commits on Enter (without Shift)", () => {
    const { doc } = makeFakeDom();
    const el = leaf(doc, "h2", "Before");
    let after: string | null = null;
    beginInlineTextEdit(el as unknown as Element, doc as unknown as Document, {
      onCommit: (_b, a) => {
        after = a;
      },
    });
    el.textContent = "After";
    el.dispatch("keydown", { key: "Enter", shiftKey: false, preventDefault: () => {} });
    expect(after).toBe("After");
  });

  it("cancels on Escape, restoring the original text and not committing", () => {
    const { doc } = makeFakeDom();
    const el = leaf(doc, "p", "Original");
    let committed = false;
    let cancelled = false;
    beginInlineTextEdit(el as unknown as Element, doc as unknown as Document, {
      onCommit: () => {
        committed = true;
      },
      onCancel: () => {
        cancelled = true;
      },
    });
    el.textContent = "Typed but discarded";
    el.dispatch("keydown", { key: "Escape", preventDefault: () => {} });
    expect(committed).toBe(false);
    expect(cancelled).toBe(true);
    expect(el.textContent).toBe("Original"); // restored
  });

  it("cancel() force-restores and does not re-commit on a later blur", () => {
    const { doc } = makeFakeDom();
    const el = leaf(doc, "span", "Keep");
    let commits = 0;
    const handle = beginInlineTextEdit(el as unknown as Element, doc as unknown as Document, {
      onCommit: () => {
        commits++;
      },
    });
    handle!.cancel();
    el.dispatch("blur", {}); // guarded — already finished
    expect(commits).toBe(0);
  });
});
