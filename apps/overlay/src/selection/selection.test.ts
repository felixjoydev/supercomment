import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  newCommentInputSchema,
  type CapturedContext,
  type NewCommentInput,
} from "@supercomment/shared";
import { OverlayController } from "../controller.js";
import { SelectionState } from "./state.js";
import { HOST_ELEMENT_ID } from "../shell/root.js";
import {
  makeFakeDom,
  setRectProvider,
  makeRect,
  FakeElement,
  type FakeDocument,
  type FakeWindow,
} from "../test/dom-double.js";
import type {
  ContextCapturer,
  CommentSubmitter,
  SelectionTarget,
  SubmitResult,
  NameStorage,
} from "../core/types.js";

// --- Helpers ---------------------------------------------------------------

function rectFor(el: Element): {
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
} {
  return (el as unknown as FakeElement).getBoundingClientRect();
}

class RecordingCapturer implements ContextCapturer {
  lastTarget: SelectionTarget | null = null;
  capture(target: SelectionTarget): CapturedContext {
    this.lastTarget = target;
    return {
      selector: "stub",
      anchors: [{ type: "dom-path", value: "stub" }],
      url: "https://example.test/",
      consoleErrors: [],
    };
  }
}

class RecordingSubmitter implements CommentSubmitter {
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

function makeController(opts?: {
  storage?: NameStorage;
  capturer?: RecordingCapturer;
  submitter?: RecordingSubmitter;
}): {
  controller: OverlayController;
  doc: FakeDocument;
  win: FakeWindow;
  capturer: RecordingCapturer;
  submitter: RecordingSubmitter;
} {
  const { doc, win } = makeFakeDom();
  const capturer = opts?.capturer ?? new RecordingCapturer();
  const submitter = opts?.submitter ?? new RecordingSubmitter();
  const controller = new OverlayController({
    previewId: "11111111-1111-4111-8111-111111111111",
    previewKey: "preview-a",
    capturer,
    submitter,
    // Cast: the overlay treats the document via the DOM interface it uses.
    doc: doc as unknown as Document,
    storage: opts?.storage ?? memoryStorage({ "supercomment:guest-name:preview-a": "Alex" }),
  });
  return { controller, doc, win, capturer, submitter };
}

beforeEach(() => {
  setRectProvider((el) => {
    const r = el.getAttribute("data-rect");
    if (r) {
      const [x, y, w, h] = r.split(",").map(Number) as [
        number,
        number,
        number,
        number,
      ];
      return makeRect(x, y, w, h);
    }
    return makeRect(0, 0, 10, 10);
  });
});

// --- SelectionState (pure) -------------------------------------------------

describe("SelectionState", () => {
  it("element mode selects exactly one element", () => {
    const { doc } = makeFakeDom();
    const state = new SelectionState((el) => rectFor(el));
    const el = doc.createElement("button");
    const target = state.selectElement(el as unknown as Element);
    expect(target.kind).toBe("element");
    expect(state.getPending()).toBe(target);
  });

  it("area drag produces a region selection", () => {
    const state = new SelectionState((el) => rectFor(el));
    state.setMode("area");
    state.beginAreaDrag(10, 20);
    const target = state.endAreaDrag(110, 220);
    expect(target?.kind).toBe("area");
    expect(target && target.kind === "area" && target.rect).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 200,
    });
  });

  it("text mode captures the quoted text", () => {
    const state = new SelectionState((el) => rectFor(el));
    state.setMode("text");
    const target = state.selectText("  hello world  ", makeRect(0, 0, 5, 5));
    expect(target?.kind).toBe("text");
    expect(target && target.kind === "text" && target.quotedText).toBe(
      "hello world",
    );
  });

  it("multi mode accumulates >=2 elements and confirms as one target", () => {
    const { doc } = makeFakeDom();
    const state = new SelectionState((el) => rectFor(el));
    state.setMode("multi");
    const a = doc.createElement("div") as unknown as Element;
    const b = doc.createElement("div") as unknown as Element;
    expect(state.toggleMulti(a)).toBe(true);
    expect(state.toggleMulti(b)).toBe(true);
    expect(state.multiCount()).toBe(2);
    const target = state.confirmMulti();
    expect(target?.kind).toBe("multi");
    expect(target && target.kind === "multi" && target.elements.length).toBe(2);
  });

  it("clicking a selected element in multi mode deselects it", () => {
    const { doc } = makeFakeDom();
    const state = new SelectionState((el) => rectFor(el));
    state.setMode("multi");
    const a = doc.createElement("div") as unknown as Element;
    expect(state.toggleMulti(a)).toBe(true);
    expect(state.toggleMulti(a)).toBe(false);
    expect(state.multiCount()).toBe(0);
  });

  it("switching modes clears any in-progress selection", () => {
    const { doc } = makeFakeDom();
    const state = new SelectionState((el) => rectFor(el));
    state.selectElement(doc.createElement("a") as unknown as Element);
    expect(state.getPending()).not.toBeNull();
    state.setMode("area");
    expect(state.getPending()).toBeNull();
  });
});

// --- Controller flow -------------------------------------------------------

describe("OverlayController — element mode", () => {
  it("highlights one element, opens the form, and submits a well-formed payload + marker", async () => {
    const { controller, doc, capturer, submitter } = makeController();
    const el = doc.createElement("button");
    el.setAttribute("data-rect", "50,60,100,40");
    doc.body.appendChild(el);

    controller.changeMode("element");
    controller.handleElementClick(el as unknown as Element);

    // Exactly one highlight box + a form is open.
    const shadow = doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    expect(shadow.querySelectorAll(".sc-highlight").length).toBe(1);
    expect(shadow.querySelector(".sc-form")).not.toBeNull();

    // Fill the note and submit.
    const textarea = shadow.querySelector("textarea")!;
    textarea.value = "Make this button blue";
    const submitBtn = shadow.querySelectorAll(".sc-btn-primary")[0]!;
    submitBtn.dispatch("click", {});

    await Promise.resolve();
    await Promise.resolve();

    expect(submitter.payloads.length).toBe(1);
    const payload = submitter.payloads[0]!;
    // Payload validates against the shared contract.
    expect(() => newCommentInputSchema.parse(payload)).not.toThrow();
    expect(payload.note).toBe("Make this button blue");
    expect(payload.authorDisplayName).toBe("Alex");
    expect(capturer.lastTarget?.kind).toBe("element");

    // A numbered marker appears.
    expect(shadow.querySelectorAll(".sc-marker").length).toBe(1);
  });
});

describe("OverlayController — area / text / multi", () => {
  it("area drag selects a region and submits an area-kind comment", async () => {
    const { controller, doc, capturer, submitter } = makeController();
    controller.changeMode("area");
    controller.beginArea(10, 10);
    controller.endArea(210, 160);

    const shadow = doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    const textarea = shadow.querySelector("textarea")!;
    textarea.value = "This region is misaligned";
    shadow.querySelectorAll(".sc-btn-primary")[0]!.dispatch("click", {});
    await Promise.resolve();
    await Promise.resolve();

    expect(capturer.lastTarget?.kind).toBe("area");
    expect(submitter.payloads.length).toBe(1);
  });

  it("text mode captures the quoted text into the draft", async () => {
    const { controller, doc, capturer } = makeController();
    controller.changeMode("text");
    controller.handleTextSelection("the headline copy", makeRect(5, 5, 80, 20));

    const shadow = doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    const textarea = shadow.querySelector("textarea")!;
    // The quoted text seeds the note.
    expect(textarea.value).toContain("the headline copy");
    expect(capturer.lastTarget).toBeNull(); // not captured until submit
  });

  it("multi mode accumulates >=2 elements then confirms as ONE comment", async () => {
    const { controller, doc, capturer, submitter } = makeController();
    controller.changeMode("multi");
    const a = doc.createElement("div");
    a.setAttribute("data-rect", "0,0,20,20");
    const b = doc.createElement("div");
    b.setAttribute("data-rect", "300,300,20,20");
    controller.handleMultiClick(a as unknown as Element);
    controller.handleMultiClick(b as unknown as Element);

    controller.confirmMulti();
    const shadow = doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    shadow.querySelector("textarea")!.value = "These two are inconsistent";
    shadow.querySelectorAll(".sc-btn-primary")[0]!.dispatch("click", {});
    await Promise.resolve();
    await Promise.resolve();

    expect(submitter.payloads.length).toBe(1); // ONE comment for both
    expect(capturer.lastTarget?.kind).toBe("multi");
  });

  it("clicking a selected element in multi mode deselects it (highlight removed)", () => {
    const { controller, doc } = makeController();
    controller.changeMode("multi");
    const a = doc.createElement("div");
    a.setAttribute("data-rect", "0,0,20,20");
    controller.handleMultiClick(a as unknown as Element);
    let shadow = doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    expect(shadow.querySelectorAll(".sc-highlight").length).toBe(1);
    controller.handleMultiClick(a as unknown as Element);
    shadow = doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    expect(shadow.querySelectorAll(".sc-highlight").length).toBe(0);
  });
});

describe("OverlayController — guest name gate", () => {
  it("prompts for a name when none stored, then persists + reuses it", async () => {
    const storage = memoryStorage(); // no name yet
    const { controller, doc, submitter } = makeController({ storage });
    const el = doc.createElement("button");
    el.setAttribute("data-rect", "10,10,40,20");

    controller.changeMode("element");
    controller.handleElementClick(el as unknown as Element);
    const shadow = doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    shadow.querySelector("textarea")!.value = "Fix me";
    shadow.querySelectorAll(".sc-btn-primary")[0]!.dispatch("click", {});

    // The guest modal appears; submission is held.
    expect(shadow.querySelector(".sc-modal")).not.toBeNull();
    expect(submitter.payloads.length).toBe(0);

    // Enter a name and confirm.
    const nameInput = shadow.querySelector(".sc-modal input")!;
    nameInput.value = "Jordan";
    // The modal's primary button is the last .sc-btn-primary.
    const primaries = shadow.querySelectorAll(".sc-btn-primary");
    primaries[primaries.length - 1]!.dispatch("click", {});

    await Promise.resolve();
    await Promise.resolve();

    expect(submitter.payloads.length).toBe(1);
    expect(submitter.payloads[0]!.authorDisplayName).toBe("Jordan");
    // Persisted for next time.
    expect(storage.getItem("supercomment:guest-name:preview-a")).toBe("Jordan");
  });
});

describe("OverlayController — Escape cancels", () => {
  it("Esc closes an open form without creating a comment", () => {
    const { controller, doc, submitter } = makeController();
    const el = doc.createElement("button");
    el.setAttribute("data-rect", "0,0,30,30");
    controller.changeMode("element");
    controller.handleElementClick(el as unknown as Element);

    let shadow = doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    expect(shadow.querySelector(".sc-form")).not.toBeNull();

    controller.cancelSelection();

    shadow = doc.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    expect(shadow.querySelector(".sc-form")).toBeNull();
    expect(submitter.payloads.length).toBe(0);
  });
});

describe("Shadow isolation", () => {
  it("mounts all UI inside a shadow root and host CSS cannot reach it", () => {
    const { doc } = makeController();
    const host = doc.getElementById(HOST_ELEMENT_ID)!;
    // The toolbar lives in the shadow root, not the light DOM.
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot!.querySelector(".sc-toolbar")).not.toBeNull();
    // Nothing overlay-related leaks into the host document body.
    expect(doc.body.querySelectorAll(".sc-toolbar").length).toBe(0);
    // The style sheet is scoped inside the shadow root with :host reset.
    const style = host.shadowRoot!.children.find((c) => c.tagName === "STYLE")!;
    expect(style.textContent).toContain(":host");
    expect(style.textContent).toContain("all: initial");
  });

  it("a host CSS rule for .sc-toolbar does not apply to the shadowed node", () => {
    // Simulate a host rule by setting an inline style on a same-classed light
    // DOM node; the shadowed toolbar is a different node and unaffected.
    const { doc } = makeController();
    const decoy = doc.createElement("div");
    decoy.className = "sc-toolbar";
    decoy.style.color = "red";
    doc.body.appendChild(decoy);

    const shadowToolbar = doc
      .getElementById(HOST_ELEMENT_ID)!
      .shadowRoot!.querySelector(".sc-toolbar")!;
    expect(shadowToolbar.style.color ?? "").not.toBe("red");
    expect(shadowToolbar).not.toBe(decoy);
  });
});

// Keep vi import used even if a future test stubs timers.
void vi;
