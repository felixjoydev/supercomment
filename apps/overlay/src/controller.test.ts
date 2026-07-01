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

function memoryStorage(seed?: Record<string, string>): NameStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function makeController() {
  const { doc, win } = makeFakeDom();
  const submitter = new StubSubmitter();
  const controller = new OverlayController({
    previewId: "11111111-1111-4111-8111-111111111111",
    previewKey: "preview-a",
    capturer: new StubCapturer(),
    submitter,
    doc: doc as unknown as Document,
    storage: memoryStorage({ "supercomment:guest-name:preview-a": "Alex" }),
  });
  const shadow = () => doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
  const q = (sel: string): FakeElement | null => shadow().querySelector(sel);
  return { controller, doc, win, submitter, shadow, q };
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
    const { controller, doc, q, submitter } = makeController();
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
