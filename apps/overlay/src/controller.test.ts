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
  AgentEnqueuer,
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
  onExit?: () => void;
  canSendToAgent?: boolean;
  enqueuer?: AgentEnqueuer;
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
    ...(opts?.onExit ? { onExit: opts.onExit } : {}),
    ...(opts?.canSendToAgent ? { canSendToAgent: true } : {}),
    ...(opts?.enqueuer ? { enqueuer: opts.enqueuer } : {}),
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
  it("registers Browse + Edit among the six toolbar modes", () => {
    const { shadow } = makeController();
    const modeButtons = shadow().querySelectorAll(".sc-mode-btn");
    expect(modeButtons.length).toBe(6);
    expect(modeButtons.some((b) => b.textContent === "Edit")).toBe(true);
    expect(modeButtons.some((b) => b.textContent === "Browse")).toBe(true);
  });

  it("starts in Browse mode by default (the passive, non-intercepting mode)", () => {
    const { shadow } = makeController();
    const browseBtn = shadow()
      .querySelectorAll(".sc-mode-btn")
      .find((b) => b.textContent === "Browse")!;
    expect(browseBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("browse mode passes host-page clicks through: no form, no preventDefault", () => {
    const { doc, q } = makeController();
    const el = hostEl(doc, "a", "Nav link");
    let prevented = false;
    // Default mode is browse; simulate the captured document click the overlay
    // listens for. Browse must not open a form and must not block navigation.
    doc.dispatch("click", {
      target: el,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(q(".sc-form")).toBeNull();
    expect(q(".sc-edit-panel")).toBeNull();
    expect(prevented).toBe(false);
  });

  it("opens the properties panel (not the comment form) on an edit-mode click", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "h1", "Hero");

    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);

    expect(q(".sc-edit-panel")).not.toBeNull();
    expect(q(".sc-form")).toBeNull(); // the comment form is NOT opened in edit mode
    // In edit mode the magenta in-page inspector box is the selection indicator.
    expect(q(".sc-inspect-box")).not.toBeNull();
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

describe("OverlayController — in-page inspector (requirement D)", () => {
  it("does NOT reveal the inspector on hover in passive Browse mode", () => {
    const { doc, q } = makeController(); // default mode is browse
    const el = hostEl(doc, "h2", "Transparent pricing");
    doc.dispatch("mouseover", { target: el });
    expect(q(".sc-inspect-box")).toBeNull();
  });

  it("hover reveals the inspector in Edit mode (before a selection locks it)", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "div", "box");
    controller.changeMode("edit");
    doc.dispatch("mouseover", { target: el });
    expect(q(".sc-inspect-tag")!.textContent).toBe("<div>");
  });

  it("hover reveals the inspector in the annotation Element and Multi modes", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "p", "Copy");

    controller.changeMode("element");
    doc.dispatch("mouseover", { target: el });
    expect(q(".sc-inspect-tag")!.textContent).toBe("<p>");

    controller.changeMode("multi");
    doc.dispatch("mouseover", { target: el });
    expect(q(".sc-inspect-box")).not.toBeNull();
  });

  it("hides the inspector when switching to Browse", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "h2", "Hi");
    controller.changeMode("element");
    doc.dispatch("mouseover", { target: el });
    expect(q(".sc-inspect-box")).not.toBeNull();
    controller.changeMode("browse");
    expect(q(".sc-inspect-box")).toBeNull();
  });
});

describe("OverlayController — inline text edit (requirement E)", () => {
  it("double-clicking a text leaf in edit mode records a normalized setText", () => {
    const { controller, doc } = makeController();
    const el = hostEl(doc, "h1", "Old heading");
    controller.changeMode("edit");
    doc.dispatch("dblclick", { target: el, preventDefault: () => {} });
    // Simulate typing new copy, then blur to commit.
    el.textContent = "  New   heading ";
    el.dispatch("blur", {});
    const op = controller.editSession.list().find((o) => o.type === "setText")!;
    expect(op).toBeTruthy();
    expect(op.before).toBe("Old heading");
    expect(op.after).toBe("New heading"); // whitespace-collapsed
  });

  it("does not begin inline editing outside edit mode", () => {
    const { controller, doc } = makeController();
    const el = hostEl(doc, "h1", "Heading");
    // default browse mode
    doc.dispatch("dblclick", { target: el, preventDefault: () => {} });
    el.textContent = "Changed";
    el.dispatch("blur", {});
    expect(controller.editSession.isEmpty()).toBe(true);
  });
});

describe("OverlayController — send to agent (Phase 2)", () => {
  class IdSubmitter implements CommentSubmitter {
    payloads: NewCommentInput[] = [];
    submit(payload: NewCommentInput): SubmitResult {
      this.payloads.push(payload);
      return { ok: true, number: this.payloads.length, id: `cmt-${this.payloads.length}` };
    }
  }

  function editHero(controller: OverlayController, doc: FakeDocument, q: (s: string) => FakeElement | null) {
    const el = hostEl(doc, "h1", "Hero");
    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);
    q(".sc-ep-ctl-font-size")!.value = "64";
    q(".sc-ep-ctl-font-size")!.dispatch("input", {});
  }

  it("a non-permitted session shows no 'Send to agent' button, only 'Save comment'", () => {
    const { controller, doc, q } = makeController();
    editHero(controller, doc, q);
    expect(q(".sc-ep-send")).toBeNull();
    expect(q(".sc-ep-save")).not.toBeNull();
  });

  it("a permitted member session saves the template AND enqueues it", async () => {
    const enqueued: string[] = [];
    const enqueuer: AgentEnqueuer = {
      enqueue: async (id) => {
        enqueued.push(id);
        return true;
      },
    };
    const submitter = new IdSubmitter();
    const { controller, doc, q } = makeController({ submitter, canSendToAgent: true, enqueuer });
    editHero(controller, doc, q);
    expect(q(".sc-ep-send")).not.toBeNull();
    q(".sc-ep-send")!.dispatch("click", {});
    q("textarea")!.value = "Make the hero bigger";
    q(".sc-btn-primary")!.dispatch("click", {});
    await flush();
    expect(submitter.payloads[0]!.kind).toBe("template");
    expect(enqueued).toEqual(["cmt-1"]);
    expect(controller.editSession.isEmpty()).toBe(true);
  });

  it("'Save comment' does NOT enqueue, even for a permitted session", async () => {
    const enqueued: string[] = [];
    const enqueuer: AgentEnqueuer = {
      enqueue: async (id) => {
        enqueued.push(id);
        return true;
      },
    };
    const submitter = new IdSubmitter();
    const { controller, doc, q } = makeController({ submitter, canSendToAgent: true, enqueuer });
    editHero(controller, doc, q);
    q(".sc-ep-save")!.dispatch("click", {}); // Save, not Send
    q("textarea")!.value = "Just save it";
    q(".sc-btn-primary")!.dispatch("click", {});
    await flush();
    expect(submitter.payloads[0]!.kind).toBe("template");
    expect(enqueued).toEqual([]); // Save must not enqueue
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

  it("footer Undo removes the last recorded edit (controller wiring)", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "h1", "Hero");
    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);
    q(".sc-ep-ctl-font-size")!.value = "40";
    q(".sc-ep-ctl-font-size")!.dispatch("input", {});
    q(".sc-ep-ctl-color")!.value = "#111111";
    q(".sc-ep-ctl-color")!.dispatch("input", {});
    expect(controller.editSession.size).toBe(2);
    q(".sc-ep-undo")!.dispatch("click", {});
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

  it("falls back to a DOM snapshot when the raster upload fails (never ships the inline PNG, never loses the artifact)", async () => {
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

    const shot = submitter.payloads[0]!.context.screenshot;
    // The heavy inline PNG is NOT shipped (would risk the 3 MiB cap)...
    expect(shot).not.toBe("data:image/png;base64,AAAA");
    // ...but the before-artifact is NOT lost — it falls back to the DOM snapshot.
    expect(shot?.startsWith("data:application/json")).toBe(true);
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

describe("OverlayController — exit review session (U18)", () => {
  it("shows an Exit control on the toolbar", () => {
    const { q } = makeController();
    expect(q(".sc-exit")).not.toBeNull();
  });

  it("Exit opens a confirmation dialog and does NOT tear down until confirmed", () => {
    const { doc, q } = makeController();
    q(".sc-exit")!.dispatch("click", {});
    // The danger confirm button is shown; the overlay host is still present.
    expect(q(".sc-btn-danger")).not.toBeNull();
    expect(doc.getElementById(HOST_ELEMENT_ID)).not.toBeNull();
  });

  it("confirming Exit invokes onExit (clears session) and removes the overlay", () => {
    let cleared = 0;
    const { doc, q } = makeController({
      onExit: () => {
        cleared++;
      },
    });
    q(".sc-exit")!.dispatch("click", {});
    q(".sc-btn-danger")!.dispatch("click", {}); // confirm
    expect(cleared).toBe(1);
    expect(doc.getElementById(HOST_ELEMENT_ID)).toBeNull(); // fully torn down
  });

  it("cancelling Exit keeps the overlay and does not clear the session", () => {
    let cleared = 0;
    const { doc, q } = makeController({
      onExit: () => {
        cleared++;
      },
    });
    q(".sc-exit")!.dispatch("click", {});
    q(".sc-btn-secondary")!.dispatch("click", {}); // cancel
    expect(cleared).toBe(0);
    expect(q(".sc-btn-danger")).toBeNull(); // dialog dismissed
    expect(doc.getElementById(HOST_ELEMENT_ID)).not.toBeNull();
  });

  it("warns about unsaved edits in the confirm dialog when the buffer is non-empty", () => {
    const { controller, doc, q } = makeController();
    const el = hostEl(doc, "h1", "Hero");
    controller.changeMode("edit");
    controller.handleEditClick(el as unknown as Element);
    q(".sc-ep-ctl-font-size")!.value = "64";
    q(".sc-ep-ctl-font-size")!.dispatch("input", {});
    expect(controller.editSession.size).toBe(1);

    q(".sc-exit")!.dispatch("click", {});
    expect(q(".sc-modal-hint")!.textContent.toLowerCase()).toContain(
      "unsaved edits",
    );
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
