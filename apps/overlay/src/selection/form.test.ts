import { describe, it, expect } from "vitest";

import type { FileReaderFn } from "../core/types.js";
import { CommentForm } from "./form.js";
import { makeFakeDom, makeRect, type FakeElement } from "../test/dom-double.js";

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const OK_READER: FileReaderFn = async () => "data:image/png;base64,AAAA";

function mountForm(readFile: FileReaderFn = OK_READER) {
  const { doc } = makeFakeDom();
  const parent = doc.createElement("div");
  const submits: unknown[] = [];
  const form = new CommentForm(
    doc as unknown as Document,
    parent as unknown as HTMLElement,
    makeRect(0, 0, 10, 10),
    { onSubmit: (d) => submits.push(d), onCancel: () => {} },
    { readFile },
  );
  const q = (sel: string): FakeElement => {
    const el = parent.querySelector(sel);
    if (!el) throw new Error(`no ${sel}`);
    return el;
  };
  const selectFiles = (
    files: Array<{ name: string; size: number; type: string }>,
  ): void => {
    const input = q(".sc-ref-input");
    (input as unknown as { files: unknown }).files = files;
    input.dispatch("change", {});
  };
  return { doc, parent, form, q, selectFiles, submits };
}

describe("CommentForm — reference images (U17/R19)", () => {
  it("accepts a valid image, collects its data URL, and renders a thumbnail", async () => {
    const { form, parent, selectFiles } = mountForm();
    selectFiles([{ name: "hero.png", size: 1000, type: "image/png" }]);
    await flush();

    expect(form.getReferenceImages()).toHaveLength(1);
    expect(form.getReferenceImages()[0]).toContain("data:image/");
    expect(parent.querySelectorAll(".sc-ref-thumb").length).toBe(1);
  });

  it("rejects an oversized image client-side and reports it", async () => {
    const { form, q, selectFiles } = mountForm();
    selectFiles([{ name: "huge.png", size: 11 * 1024 * 1024, type: "image/png" }]);
    await flush();

    expect(form.getReferenceImages()).toHaveLength(0);
    expect(q(".sc-ref-error").textContent).toContain("skipped");
  });

  it("rejects a non-image type client-side", async () => {
    const { form, selectFiles } = mountForm();
    selectFiles([{ name: "notes.pdf", size: 100, type: "application/pdf" }]);
    await flush();
    expect(form.getReferenceImages()).toHaveLength(0);
  });

  it("is non-blocking: a read failure is reported but the note still submits", async () => {
    const { form, q, parent, submits, selectFiles } = mountForm(async () => null);
    selectFiles([{ name: "x.png", size: 100, type: "image/png" }]);
    await flush();

    expect(form.getReferenceImages()).toHaveLength(0);
    expect(q(".sc-ref-error").textContent).toContain("couldn't be read");

    const textarea = parent.querySelector("textarea")!;
    textarea.value = "Comment without the failed image";
    textarea.dispatch("input", {});
    parent.querySelectorAll(".sc-btn-primary")[0]!.dispatch("click", {});
    expect(submits.length).toBe(1);
  });

  it("lets the reviewer remove an attached image", async () => {
    const { form, q, parent, selectFiles } = mountForm();
    selectFiles([{ name: "a.png", size: 100, type: "image/png" }]);
    await flush();
    expect(form.getReferenceImages()).toHaveLength(1);

    q(".sc-ref-remove").dispatch("click", {});
    expect(form.getReferenceImages()).toHaveLength(0);
    expect(parent.querySelectorAll(".sc-ref-thumb").length).toBe(0);
  });
});
