import { describe, it, expect, beforeEach } from "vitest";

import type { CapturedContext, NewCommentInput } from "@supercomment/shared";

import { OverlayController } from "./controller.js";
import { HOST_ELEMENT_ID } from "./shell/root.js";
import {
  makeFakeDom,
  setRectProvider,
  makeRect,
  type FakeDocument,
  type FakeElement,
} from "./test/dom-double.js";
import type {
  ContextCapturer,
  CommentSubmitter,
  SubmitResult,
  NameStorage,
  ScreenshotUploader,
  FileReaderFn,
} from "./core/types.js";

// Edit-mode (U9) integration over the real controller + panel + EditSession.

class StubCapturer implements ContextCapturer {
  capture(): CapturedContext {
    return {
      selector: "stub",
      anchors: [{ type: "dom-path", value: "stub" }],
      url: "https://example.test/",
      consoleErrors: [],
    };
  }
}

class StubSubmitter implements CommentSubmitter {
  payloads: NewCommentInput[] = [];
  private n = 0;
  submit(payload: NewCommentInput): SubmitResult {
    this.payloads.push(payload);
    return { ok: true, number: ++this.n };
  }
}

/** A submitter that always rejects with a given (RPC-style) message. */
class FailingSubmitter implements CommentSubmitter {
  attempts = 0;
  constructor(private readonly message: string) {}
  submit(): SubmitResult {
    this.attempts++;
    return { ok: false, number: 0, message: this.message };
  }
}

/** A capturer that returns a context carrying a real image data URL screenshot. */
class ImageCapturer implements ContextCapturer {
  capture(): CapturedContext {
    return {
      selector: "stub",
      anchors: [{ type: "dom-path", value: "stub" }],
      url: "https://example.test/",
      consoleErrors: [],
      screenshot: "data:image/png;base64,AAAA",
    };
  }
}

/** Drain the async submit chain (capture → upload → submit). */
const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

function memoryStorage(seed?: Record<string, string>): NameStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function makeController(opts?: {
  capturer?: ContextCapturer;
  submitter?: CommentSubmitter;
  uploader?: ScreenshotUploader;
  readFile?: FileReaderFn;
}) {
  const { doc, win } = makeFakeDom();
  const submitter = opts?.submitter ?? new StubSubmitter();
  const controller = new OverlayController({
    previewId: "11111111-1111-4111-8111-111111111111",
    previewKey: "preview-a",
    capturer: opts?.capturer ?? new StubCapturer(),
    submitter,
    ...(opts?.uploader ? { uploader: opts.uploader } : {}),
    ...(opts?.readFile ? { readFile: opts.readFile } : {}),
    doc: doc as unknown as Document,
    storage: memoryStorage({ "supercomment:guest-name:preview-a": "Alex" }),
  });
  const shadow = () => doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
  const q = (sel: string): FakeElement | null => shadow().querySelector(sel);
  return { controller, doc, win, submitter, shadow, q };
}

/** Drive an element through: edit mode → record a font-size edit → Save as comment. */
function editAndOpenTemplateForm(
  controller: OverlayController,
  el: FakeElement,
  q: (sel: string) => FakeElement | null,
  value = "64",
): void {
  controller.changeMode("edit");
  controller.handleEditClick(el as unknown as Element);
  const fontSize = q(".sc-ep-ctl-font-size")!;
  fontSize.value = value;
  fontSize.dispatch("input", {});
  q(".sc-ep-save")!.dispatch("click", {});
}

/** A host element with a rect, appended to the page body. */
function hostEl(doc: FakeDocument, tag: string, text: string): FakeElement {
  const el = doc.createElement(tag);
  el.textContent = text;
  el.setAttribute("data-rect", "0,0,120,40");
  doc.body.appendChild(el);
  return el;
}

beforeEach(() => {
  setRectProvider((el) => {
    const r = el.getAttribute("data-rect");
    if (r) {
      const [x, y, w, h] = r.split(",").map(Number) as [number, number, number, number];
      return makeRect(x, y, w, h);
    }
    return makeRect(0, 0, 10, 10);
  });
});

describe("OverlayController — edit mode registration", () => {
  it("registers Edit as a fifth toolbar mode", () => {
    const { shadow } = makeController();
    const modeButtons = shadow().querySelectorAll(".sc-mode-btn");
    expect(modeButtons.length).toBe(5);
    expect(modeButtons.some((b) => b.textContent === "Edit")).toBe(true);
  });

  it("opens the properties panel (not the comment form) on an edit-mode click", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "h1", "Hero");

    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);

    expect(q(".sc-edit-panel")).not.toBeNull();
    expect(q(".sc-form")).toBeNull(); // the comment form is NOT opened in edit mode
    expect(q(".sc-highlight")).not.toBeNull();
  });

  it("routes a host-page click through bindEvents when in edit mode", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "p", "Paragraph");
    controller.changeMode("edit");

    // Simulate the captured document click the overlay listens for.
    doc.dispatch("click", { target: el, preventDefault: () => {} });

    expect(q(".sc-edit-panel")).not.toBeNull();
  });
});

describe("OverlayController — edit buffer lifecycle (G13/R7)", () => {
  it("records panel edits into the controller's durable EditSession", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "h1", "Hero");
    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);

    const fontSize = q(".sc-ep-ctl-font-size")!;
    fontSize.value = "64";
    fontSize.dispatch("input", {});

    expect(controller.editSession.size).toBe(1);
    expect(controller.editSession.list()[0]!.after).toBe("64px");
  });

  it("preserves the buffer across a mode switch (panel closes, edits stay)", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "h1", "Hero");
    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);
    const fontSize = q(".sc-ep-ctl-font-size")!;
    fontSize.value = "48";
    fontSize.dispatch("input", {});
    expect(controller.editSession.size).toBe(1);

    controller.changeMode("element");
    expect(q(".sc-edit-panel")).toBeNull(); // panel UI dismissed
    expect(controller.editSession.size).toBe(1); // buffer preserved
  });

  it("preserves the buffer across Esc (cancelSelection)", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "h1", "Hero");
    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);
    q(".sc-ep-ctl-font-size")!.value = "50";
    q(".sc-ep-ctl-font-size")!.dispatch("input", {});

    controller.cancelSelection();
    expect(q(".sc-edit-panel")).toBeNull();
    expect(controller.editSession.size).toBe(1);
  });

  it("keeps edits private — nothing is submitted while editing (R7)", () => {
    const submitter = new StubSubmitter();
    const { controller, doc, q } = makeController({ submitter });
    const el = hostEl(doc, "h1", "Hero");
    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);
    q(".sc-ep-ctl-font-size")!.value = "40";
    q(".sc-ep-ctl-font-size")!.dispatch("input", {});
    q(".sc-ep-ctl-color")!.value = "#112233";
    q(".sc-ep-ctl-color")!.dispatch("input", {});

    expect(controller.editSession.size).toBe(2);
    expect(submitter.payloads.length).toBe(0); // nothing left the browser
  });
});

describe("OverlayController — template submit (U13)", () => {
  it("folds the change-set + kind='template' at submit and clears the buffer", async () => {
    const submitter = new StubSubmitter();
    const { controller, doc, q } = makeController({ submitter });
    const el = hostEl(doc, "h1", "Hero");

    editAndOpenTemplateForm(controller, el, q);
    // The panel is dismissed; the comment form is open for the note.
    expect(q(".sc-edit-panel")).toBeNull();
    const textarea = q("textarea")!;
    textarea.value = "Make the hero heading bigger";
    q(".sc-btn-primary")!.dispatch("click", {});
    await flush();

    expect(submitter.payloads.length).toBe(1);
    const payload = submitter.payloads[0]!;
    expect(payload.kind).toBe("template");
    expect(payload.context.changeSet?.ops.length).toBeGreaterThanOrEqual(1);
    // The saved edits are cleared so they don't ride a later comment (R7).
    expect(controller.editSession.isEmpty()).toBe(true);
    // R11: the placed pin is the distinct template treatment.
    expect(q(".sc-marker.sc-template")).not.toBeNull();
  });

  it("does NOT absorb the buffer into an ordinary comment made mid-edit", async () => {
    const submitter = new StubSubmitter();
    const { controller, doc, q } = makeController({ submitter });
    const el = hostEl(doc, "h1", "Hero");
    // Buffer an edit, but comment via the ordinary element flow (not "Save").
    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);
    q(".sc-ep-ctl-font-size")!.value = "64";
    q(".sc-ep-ctl-font-size")!.dispatch("input", {});

    controller.changeMode("element");
    const other = hostEl(doc, "p", "Body copy");
    controller.handleElementClick(other as unknown as Element);
    q("textarea")!.value = "Unrelated note";
    q(".sc-btn-primary")!.dispatch("click", {});
    await flush();

    const payload = submitter.payloads[0]!;
    expect(payload.kind).toBeUndefined(); // ordinary comment
    expect(payload.context.changeSet).toBeUndefined();
    expect(controller.editSession.size).toBe(1); // buffer untouched
  });

  it("surfaces a rate-limit rejection and preserves the form + buffer (G5)", async () => {
    const submitter = new FailingSubmitter(
      "create_review_comment failed (429): rate_limited",
    );
    const { controller, doc, q, shadow } = makeController({ submitter });
    const el = hostEl(doc, "h1", "Hero");

    editAndOpenTemplateForm(controller, el, q);
    q("textarea")!.value = "Bigger hero";
    q(".sc-btn-primary")!.dispatch("click", {});
    await flush();

    // The error is shown, not swallowed.
    const notice = shadow().querySelector(".sc-device-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent.toLowerCase()).toContain("quickly");
    // The form stays open and the buffer survives for a retry.
    expect(q(".sc-form")).not.toBeNull();
    expect(controller.editSession.size).toBe(1);
  });

  it("uploads a real image screenshot out-of-band and stores the ref (U13/U7)", async () => {
    const uploaded: string[] = [];
    const uploader: ScreenshotUploader = {
      uploadDataUrl: async (dataUrl) => {
        uploaded.push(dataUrl);
        return "11111111-1111-4111-8111-111111111111/cap-1.png";
      },
    };
    const submitter = new StubSubmitter();
    const { controller, doc, q } = makeController({
      submitter,
      capturer: new ImageCapturer(),
      uploader,
    });
    const el = hostEl(doc, "h1", "Hero");

    editAndOpenTemplateForm(controller, el, q);
    q("textarea")!.value = "Bigger hero";
    q(".sc-btn-primary")!.dispatch("click", {});
    await flush();

    expect(uploaded.length).toBe(1);
    expect(uploaded[0]).toContain("data:image/png");
    // The heavy inline data URL is replaced by the lightweight Storage ref.
    expect(submitter.payloads[0]!.context.screenshot).toBe(
      "11111111-1111-4111-8111-111111111111/cap-1.png",
    );
  });

  it("drops the inline raster when the upload fails (never ships it over the cap)", async () => {
    const uploader: ScreenshotUploader = { uploadDataUrl: async () => null };
    const submitter = new StubSubmitter();
    const { controller, doc, q } = makeController({
      submitter,
      capturer: new ImageCapturer(),
      uploader,
    });
    const el = hostEl(doc, "h1", "Hero");

    editAndOpenTemplateForm(controller, el, q);
    q("textarea")!.value = "Bigger hero";
    q(".sc-btn-primary")!.dispatch("click", {});
    await flush();

    expect(submitter.payloads[0]!.context.screenshot).toBeUndefined();
  });
});

describe("OverlayController — teardown (plans/008)", () => {
  it("destroy() unbinds the document listeners and removes the host", () => {
    const { controller, doc } = makeController();
    const clicks = () =>
      (
        (doc as unknown as { docListeners: Map<string, unknown[]> }).docListeners.get(
          "click",
        ) ?? []
      ).length;

    expect(clicks()).toBeGreaterThan(0);
    controller.destroy();
    expect(clicks()).toBe(0);
    expect(doc.getElementById(HOST_ELEMENT_ID)).toBeNull();
  });
});

describe("OverlayController — composer reference images (U17/R19)", () => {
  function attachReference(q: (sel: string) => FakeElement | null): void {
    const input = q(".sc-ref-input")!;
    (input as unknown as { files: unknown }).files = [
      { name: "ref.png", size: 1000, type: "image/png" },
    ];
    input.dispatch("change", {});
  }

  it("uploads a reference image out-of-band and stores its ref in context.referenceImages", async () => {
    const submitter = new StubSubmitter();
    const uploaded: string[] = [];
    const uploader: ScreenshotUploader = {
      uploadDataUrl: async (dataUrl) => {
        uploaded.push(dataUrl);
        return `preview/ref-${uploaded.length}.png`;
      },
    };
    const readFile: FileReaderFn = async () => "data:image/png;base64,AAAA";
    const { controller, doc, q } = makeController({ submitter, uploader, readFile });
    const el = hostEl(doc, "button", "Buy");

    controller.changeMode("element");
    controller.handleElementClick(el as unknown as Element);
    attachReference(q);
    await flush();

    q("textarea")!.value = "See the attached mock";
    q(".sc-btn-primary")!.dispatch("click", {});
    await flush();

    expect(submitter.payloads.length).toBe(1);
    expect(submitter.payloads[0]!.context.referenceImages).toEqual([
      "preview/ref-1.png",
    ]);
  });

  it("is non-blocking: a failed upload leaves referenceImages unset and the comment still posts", async () => {
    const submitter = new StubSubmitter();
    const uploader: ScreenshotUploader = { uploadDataUrl: async () => null };
    const readFile: FileReaderFn = async () => "data:image/png;base64,AAAA";
    const { controller, doc, q } = makeController({ submitter, uploader, readFile });
    const el = hostEl(doc, "button", "Buy");

    controller.changeMode("element");
    controller.handleElementClick(el as unknown as Element);
    attachReference(q);
    await flush();

    q("textarea")!.value = "Comment posts even if the upload failed";
    q(".sc-btn-primary")!.dispatch("click", {});
    await flush();

    expect(submitter.payloads.length).toBe(1);
    expect(submitter.payloads[0]!.context.referenceImages).toBeUndefined();
  });
});
