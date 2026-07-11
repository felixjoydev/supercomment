import { describe, it, expect } from "vitest";

import { changeOpSchema, type ChangeOp } from "@supercomment/shared";

import {
  makeFakeDom,
  type FakeDocument,
  type FakeElement,
} from "../test/dom-double.js";
import {
  PropertiesPanel,
  normalizeHex,
  rgbToHex,
  type PanelCallbacks,
} from "./panel.js";
import { EditSession } from "./edit-session.js";
import { buildEditTarget } from "./edit-target.js";

// The panel is exercised against its REAL collaborator — a live EditSession — so
// these are integration tests over the exact wiring the controller uses. The fake
// DOM has no getComputedStyle, so we assert on RECORDED ops (the durable
// artifact), not on visual application (per the overlay test guardrails).

function makeEl(doc: FakeDocument, tag: string, text = "x"): FakeElement {
  const el = doc.createElement(tag);
  el.textContent = text;
  doc.body.appendChild(el);
  return el;
}

/** A container element inside a parent that has siblings (so Arrange shows). */
function withSiblings(
  doc: FakeDocument,
  tag: string,
): { el: FakeElement; parent: FakeElement } {
  const parent = doc.createElement("section");
  doc.body.appendChild(parent);
  const a = doc.createElement(tag);
  const b = doc.createElement(tag);
  const c = doc.createElement(tag);
  parent.append(a, b, c);
  return { el: b, parent };
}

function mount(opts?: {
  el?: FakeElement;
  doc?: FakeDocument;
  canSendToAgent?: boolean;
  isMember?: boolean;
  initialPromptText?: string;
  fontEnv?: PanelCallbacks["fontEnv"];
  fontRecents?: string[];
}) {
  const { doc } = opts?.doc ? { doc: opts.doc } : makeFakeDom();
  const parent = doc.createElement("div"); // stands in for shell.layer
  const el = opts?.el ?? makeEl(doc, "button", "Buy");
  const session = new EditSession();
  const state = { closed: false, saved: false, sentToAgent: false, promptText: "" };
  const cb: PanelCallbacks = {
    record: (op) => session.record(op),
    removeEdit: (op) => session.remove(op),
    undo: () => {
      session.undoLast();
    },
    redo: () => session.history.redo(),
    discard: () => session.discard(),
    count: () => session.size,
    canUndo: () => session.history.canUndo(),
    canRedo: () => session.history.canRedo(),
    entries: () => session.history.entries(),
    revertEdit: (key) => session.history.revertKey(key),
    onClose: () => {
      state.closed = true;
    },
    onSave: () => {
      state.saved = true;
    },
    ...(opts?.canSendToAgent
      ? {
          canSendToAgent: true,
          onSendToAgent: () => {
            state.sentToAgent = true;
          },
        }
      : {}),
    ...(opts?.isMember
      ? {
          isMember: true,
          getPromptText: () => opts.initialPromptText ?? "",
          onPromptChange: (text: string) => {
            state.promptText = text;
          },
        }
      : {}),
    ...(opts?.fontEnv !== undefined
      ? {
          fontEnv: opts.fontEnv,
          fontRecents: () => opts.fontRecents ?? [],
          onFontPicked: () => {},
        }
      : {}),
  };
  const target = buildEditTarget(el as unknown as Element, doc as unknown as Document);
  const panel = new PropertiesPanel(
    doc as unknown as Document,
    parent as unknown as HTMLElement,
    el as unknown as Element,
    target,
    cb,
  );
  const q = (sel: string): FakeElement => {
    const found = parent.querySelector(sel);
    if (!found) throw new Error(`no element for ${sel}`);
    return found;
  };
  const maybe = (sel: string): FakeElement | null => parent.querySelector(sel);
  const segByText = (containerSel: string, text: string): FakeElement => {
    const btn = parent
      .querySelectorAll(`${containerSel} .sc-ep-seg`)
      .find((b) => b.textContent === text);
    if (!btn) throw new Error(`no segment "${text}" in ${containerSel}`);
    return btn;
  };
  return { doc, parent, el, session, panel, state, q, maybe, segByText };
}

describe("PropertiesPanel — contextual sections (requirement A + user note)", () => {
  it("a TEXT element shows Type settings + Colour, not Layout/Spacing/Size", () => {
    const { doc } = makeFakeDom();
    const { parent } = mount({ el: makeEl(doc, "h2", "Transparent pricing"), doc });
    expect(parent.querySelector(".sc-ep-ctl-font-size")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-font-weight")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-letter-spacing")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-text-align")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-color")).not.toBeNull(); // text colour
    // No container-only sections:
    expect(parent.querySelector(".sc-ep-ctl-flex-direction")).toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-width")).toBeNull();
    expect(parent.querySelector(".sc-ep-cross")).toBeNull();
  });

  it("a CONTAINER element shows Layout/Spacing/Size/Position/Colour, not Type", () => {
    const { doc } = makeFakeDom();
    const { parent } = mount({ el: makeEl(doc, "div", "box"), doc });
    expect(parent.querySelector(".sc-ep-ctl-flex-direction")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-align-items")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-gap")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-width")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-height")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-cross")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-background-color")).not.toBeNull();
    // No type controls on a container:
    expect(parent.querySelector(".sc-ep-ctl-font-size")).toBeNull();
  });

  it("the tag badge names the element (uppercase)", () => {
    const { doc } = makeFakeDom();
    const { q } = mount({ el: makeEl(doc, "h2", "Hi"), doc });
    expect(q(".sc-ep-tag").textContent).toBe("H2");
  });

  it("an IMAGE element shows an Image section (replace/fit/radius), not a background colour (R6, U6)", () => {
    const { doc } = makeFakeDom();
    const { parent } = mount({ el: makeEl(doc, "img", ""), doc });
    expect(parent.querySelector(".sc-ep-ctl-image-url")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-image-apply")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-object-fit")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-border-radius")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-background-color")).toBeNull(); // no bg on an image
  });

  it("an SVG element shows no colour section (R6, U6)", () => {
    const { doc } = makeFakeDom();
    const { parent } = mount({ el: makeEl(doc, "svg", ""), doc });
    expect(parent.querySelector(".sc-ep-ctl-background-color")).toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-color")).toBeNull();
  });

  it("every element gets a Hide control (R13, U6)", () => {
    const { doc } = makeFakeDom();
    const { maybe } = mount({ el: makeEl(doc, "div", "box"), doc });
    expect(maybe(".sc-ep-hide")).not.toBeNull();
  });
});

describe("PropertiesPanel — Type settings (text)", () => {
  it("records a setStyle font-size with the px unit", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    const input = q(".sc-ep-ctl-font-size");
    input.value = "48";
    input.dispatch("input", {});
    const op = session.list()[0]!;
    expect(op.type).toBe("setStyle");
    expect(op.property).toBe("font-size");
    expect(op.after).toBe("48px");
    expect(op.target.selector.length).toBeGreaterThan(0);
  });

  it("records line-height in px, never a unitless multiplier (U1 marquee fix)", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "p", "Copy"), doc });
    const input = q(".sc-ep-ctl-line-height");
    input.value = "26";
    input.dispatch("input", {});
    const op = session.list().find((o) => o.property === "line-height")!;
    expect(op.after).toBe("26px");
  });

  it("records a font-weight select change", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "p", "Copy"), doc });
    const select = q(".sc-ep-ctl-font-weight");
    select.value = "700";
    select.dispatch("change", {});
    const op = session.list()[0]!;
    expect(op.property).toBe("font-weight");
    expect(op.after).toBe("700");
  });

  it("records text-align via the segmented control", () => {
    const { doc } = makeFakeDom();
    const { session, segByText } = mount({ el: makeEl(doc, "h2", "Hi"), doc });
    segByText(".sc-ep-ctl-text-align", "Center").dispatch("click", {});
    const op = session.list()[0]!;
    expect(op.property).toBe("text-align");
    expect(op.after).toBe("center");
  });

  it("coalesces repeated size nudges into a single edit", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    const input = q(".sc-ep-ctl-font-size");
    input.value = "40";
    input.dispatch("input", {});
    input.value = "52";
    input.dispatch("input", {});
    expect(session.size).toBe(1);
    expect(session.list()[0]!.after).toBe("52px");
  });

  it("opens the font picker and records a font-family op with identity (U8)", async () => {
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const { doc } = makeFakeDom();
    const fontEnv: PanelCallbacks["fontEnv"] = {
      loadCatalog: async () => ({
        version: 1,
        families: [{ name: "Inter", category: "sans-serif", weights: ["400", "700"] }],
      }),
      loadFamily: async (family, weights) => ({
        ok: true,
        family,
        weights,
        previewUnavailable: false,
      }),
      uploadCapable: false,
    };
    const { session, parent, q } = mount({ el: makeEl(doc, "h1", "Hero"), doc, fontEnv });

    // The font control is a picker-opening button, not a five-option dropdown.
    q(".sc-ep-fontbtn").dispatch("click", {});
    await tick(); // catalog fetch + render

    const row = parent
      .querySelectorAll(".sc-ep-fontrow")
      .find((r) => r.textContent.startsWith("Inter"))!;
    row.dispatch("click", {});
    await tick(); // Google face load

    const op = session.list().find((o) => o.property === "font-family")!;
    expect(op.after).toBe('"Inter", sans-serif');
    expect(op.font).toMatchObject({ family: "Inter", source: "google" });
    // Weight options adapted to Inter's real weights.
    const weightSel = q(".sc-ep-ctl-font-weight");
    expect(weightSel.querySelectorAll("option").map((o) => o.value)).toEqual(["400", "700"]);
  });
});

describe("PropertiesPanel — Colour + opacity", () => {
  it("records the colour from the hex field and mirrors it to the swatch", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "h2", "Hi"), doc });
    const hex = q(".sc-ep-ctl-hex");
    hex.value = "#123456";
    hex.dispatch("input", {});
    const op = session.list().find((o) => o.property === "color")!;
    expect(op.after).toBe("#123456");
  });

  it("records opacity as a 0–1 fraction from the percent field", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "div", "box"), doc });
    const op = q(".sc-ep-ctl-opacity");
    op.value = "50";
    op.dispatch("input", {});
    const recorded = session.list().find((o) => o.property === "opacity")!;
    expect(recorded.after).toBe("0.5");
  });
});

describe("PropertiesPanel — Layout (container) implies display:flex", () => {
  it("recording a flex-direction also records display:flex for a coherent change-set", () => {
    const { doc } = makeFakeDom();
    const { session, segByText } = mount({ el: makeEl(doc, "div", "box"), doc });
    segByText(".sc-ep-ctl-flex-direction", "Column").dispatch("click", {});
    const props = session.list().map((o) => o.property);
    expect(props).toContain("display");
    expect(props).toContain("flex-direction");
    expect(session.list().find((o) => o.property === "display")!.after).toBe("flex");
    expect(session.list().find((o) => o.property === "flex-direction")!.after).toBe("column");
  });

  it("records gap in px", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "div", "box"), doc });
    const gap = q(".sc-ep-ctl-gap");
    gap.value = "48";
    gap.dispatch("input", {});
    expect(session.list().find((o) => o.property === "gap")!.after).toBe("48px");
  });
});

describe("PropertiesPanel — Spacing (padding/margin toggle + lock)", () => {
  it("records padding-<side> by default and margin-<side> after toggling", () => {
    const { doc } = makeFakeDom();
    const { session, q, segByText } = mount({ el: makeEl(doc, "div", "box"), doc });
    const top = q(".sc-ep-ctl-top");
    top.value = "12";
    top.dispatch("input", {});
    expect(session.list().find((o) => o.property === "padding-top")!.after).toBe("12px");

    segByText(".sc-ep-spacing-toggle", "Margin").dispatch("click", {});
    top.value = "8";
    top.dispatch("input", {});
    expect(session.list().find((o) => o.property === "margin-top")!.after).toBe("8px");
  });

  it("with Lock on, editing one side records all four sides", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "div", "box"), doc });
    q(".sc-ep-lock").dispatch("click", {}); // enable lock
    const top = q(".sc-ep-ctl-top");
    top.value = "16";
    top.dispatch("input", {});
    const props = session.list().map((o) => o.property).sort();
    expect(props).toEqual([
      "padding-bottom",
      "padding-left",
      "padding-right",
      "padding-top",
    ]);
  });
});

describe("PropertiesPanel — Size (Fixed/Auto)", () => {
  it("records a fixed width in px", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "div", "box"), doc });
    const mode = q(".sc-ep-ctl-width-mode");
    mode.value = "fixed";
    mode.dispatch("change", {});
    const w = q(".sc-ep-ctl-width");
    w.value = "1228";
    w.dispatch("input", {});
    expect(session.list().find((o) => o.property === "width")!.after).toBe("1228px");
  });

  it("records width:auto when the mode is set to Auto", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "div", "box"), doc });
    const mode = q(".sc-ep-ctl-width-mode");
    mode.value = "auto";
    mode.dispatch("change", {});
    expect(session.list().find((o) => o.property === "width")!.after).toBe("auto");
  });
});

describe("PropertiesPanel — Position (place-self cross)", () => {
  it("records place-self from a cross anchor", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "div", "box"), doc });
    q(".sc-ep-cross-center").dispatch("click", {});
    const op = session.list().find((o) => o.property === "place-self")!;
    expect(op.after).toBe("center center");
  });
});

describe("PropertiesPanel — remaining R13 controls (U18)", () => {
  it("records font-style italic via the segmented control", () => {
    const { doc } = makeFakeDom();
    const { session, segByText } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    segByText(".sc-ep-ctl-font-style", "Italic").dispatch("click", {});
    const op = session.list().find((o) => o.property === "font-style")!;
    expect(op.after).toBe("italic");
  });

  it("records text-transform and text-decoration-line", () => {
    const { doc } = makeFakeDom();
    const { session, segByText } = mount({ el: makeEl(doc, "p", "Copy"), doc });
    segByText(".sc-ep-ctl-text-transform", "AG").dispatch("click", {});
    expect(session.list().find((o) => o.property === "text-transform")!.after).toBe("uppercase");
    segByText(".sc-ep-ctl-text-decoration-line", "Underline").dispatch("click", {});
    expect(
      session.list().find((o) => o.property === "text-decoration-line")!.after,
    ).toBe("underline");
  });

  it("records border-radius in px and a box-shadow preset string", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "div", "box"), doc });
    const radius = q(".sc-ep-ctl-border-radius");
    radius.value = "12";
    radius.dispatch("input", {});
    expect(session.list().find((o) => o.property === "border-radius")!.after).toBe("12px");

    const shadow = q(".sc-ep-ctl-box-shadow");
    shadow.value = "0 4px 12px rgba(0, 0, 0, 0.15)";
    shadow.dispatch("change", {});
    expect(session.list().find((o) => o.property === "box-shadow")!.after).toBe(
      "0 4px 12px rgba(0, 0, 0, 0.15)",
    );
  });

  it("records a border colour and toggles the per-corner radius inputs", () => {
    const { doc } = makeFakeDom();
    const { session, q, parent } = mount({ el: makeEl(doc, "div", "box"), doc });
    const hex = q(".sc-ep-ctl-border-color-hex");
    hex.value = "#334455";
    hex.dispatch("input", {});
    expect(session.list().find((o) => o.property === "border-color")!.after).toBe("#334455");

    const corners = parent.querySelector(".sc-ep-corners")!;
    expect(corners.getAttribute("data-open")).toBe("0");
    parent.querySelectorAll(".sc-ep-corners-toggle")[0]!.dispatch("click", {});
    expect(corners.getAttribute("data-open")).toBe("1");
    expect(parent.querySelector(".sc-ep-ctl-border-top-left-radius")).not.toBeNull();
  });
});

describe("PropertiesPanel — Image replace + Hide (U6)", () => {
  it("records a swapMedia op from a valid https URL, previewing the new src", () => {
    const { doc } = makeFakeDom();
    const img = makeEl(doc, "img", "");
    img.setAttribute("src", "old.png");
    img.setAttribute("srcset", "old.png 2x");
    const { session, q } = mount({ el: img, doc });
    const url = q(".sc-ep-ctl-image-url");
    url.value = "https://cdn.example.com/new.png";
    q(".sc-ep-image-apply").dispatch("click", {});
    const op = session.list().find((o) => o.type === "setAttr" && o.property === "src")!;
    expect(op).toBeTruthy();
    expect(op.after).toBe("https://cdn.example.com/new.png");
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/new.png"); // previewed
    expect(img.getAttribute("srcset")).toBeNull(); // srcset neutralized so the swap shows
  });

  it("does not record for an unsafe URL (http / private host) and flags the control", () => {
    const { doc } = makeFakeDom();
    const img = makeEl(doc, "img", "");
    const { session, q, parent } = mount({ el: img, doc });
    q(".sc-ep-ctl-image-url").value = "http://localhost/x.png";
    q(".sc-ep-image-apply").dispatch("click", {});
    expect(session.list().some((o) => o.type === "setAttr")).toBe(false);
    expect(parent.querySelector(".sc-ep-image-url")!.getAttribute("data-sc-degraded")).toBe("1");
  });

  it("Hide records a setVisibility op (R13)", () => {
    const { doc } = makeFakeDom();
    const el = makeEl(doc, "div", "box");
    const { session, q } = mount({ el, doc });
    q(".sc-ep-hide").dispatch("click", {});
    const op = session.list().find((o) => o.type === "setVisibility")!;
    expect(op).toBeTruthy();
    expect(op.after).toBe("hidden");
    expect(op.before).toBe("visible");
  });
});

describe("PropertiesPanel — Arrange (functional reorder, requirement F)", () => {
  it("shows Move up/down only when the element has siblings", () => {
    const { doc } = makeFakeDom();
    const lonely = mount({ el: makeEl(doc, "div", "only"), doc });
    expect(lonely.maybe(".sc-ep-move-up")).toBeNull();

    const { doc: doc2 } = makeFakeDom();
    const { el } = withSiblings(doc2, "div");
    const withArrange = mount({ el, doc: doc2 });
    expect(withArrange.maybe(".sc-ep-move-up")).not.toBeNull();
  });

  it("records a moveNode with a parent anchor, reference neighbour, and before/after", () => {
    const { doc } = makeFakeDom();
    const { el, parent } = withSiblings(doc, "div"); // el is the MIDDLE child (index 1)
    const { session, q } = mount({ el, doc });
    q(".sc-ep-move-up").dispatch("click", {});
    const op = session.list().find((o) => o.type === "moveNode")!;
    expect(op).toBeTruthy();
    expect(op.order).toEqual({ from: 1, to: 0 });
    expect(op.insertion?.position).toBe("before");
    expect(op.insertion?.parent).toBeTruthy();
    expect(op.insertion?.reference).toBeTruthy();
    // The preview ACTUALLY moved the node (requirement F): middle → first.
    expect(parent.children.indexOf(el)).toBe(0);
  });
});

describe("PropertiesPanel — footer (N edits · Undo · Save comment)", () => {
  it("disables Undo + Save until there's an edit, then enables both", () => {
    const { doc } = makeFakeDom();
    const { q } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    expect(q(".sc-ep-save").disabled).toBe(true);
    expect(q(".sc-ep-undo").disabled).toBe(true);
    const input = q(".sc-ep-ctl-font-size");
    input.value = "40";
    input.dispatch("input", {});
    expect(q(".sc-ep-save").disabled).toBe(false);
    expect(q(".sc-ep-undo").disabled).toBe(false);
  });

  it("shows the edit count and updates it", () => {
    const { doc } = makeFakeDom();
    const { q } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    expect(q(".sc-ep-count").textContent).toBe("0 edits");
    const input = q(".sc-ep-ctl-font-size");
    input.value = "40";
    input.dispatch("input", {});
    expect(q(".sc-ep-count").textContent).toBe("1 edit");
  });

  it("has a Redo button, disabled until there is something to redo (U3)", () => {
    const { doc } = makeFakeDom();
    const { q } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    const redo = q(".sc-ep-redo");
    expect(redo.disabled).toBe(true);
    const input = q(".sc-ep-ctl-font-size");
    input.value = "40";
    input.dispatch("input", {});
    q(".sc-ep-undo").dispatch("click", {}); // undo → now redoable
    expect(q(".sc-ep-redo").disabled).toBe(false);
    q(".sc-ep-redo").dispatch("click", {});
    expect(q(".sc-ep-redo").disabled).toBe(true);
  });

  it("the counter opens a session review list with a revert per row and Discard all (R17)", () => {
    const { doc } = makeFakeDom();
    const { session, q, maybe, parent } = mount({ el: makeEl(doc, "div", "box"), doc });
    q(".sc-ep-ctl-top").value = "8";
    q(".sc-ep-ctl-top").dispatch("input", {});
    q(".sc-ep-ctl-bottom").value = "12";
    q(".sc-ep-ctl-bottom").dispatch("input", {});
    expect(session.size).toBe(2);
    // Open the list.
    q(".sc-ep-count").dispatch("click", {});
    expect(parent.querySelectorAll(".sc-ep-edit-row").length).toBe(2);
    expect(maybe(".sc-ep-edits-discard")).not.toBeNull();
    // Revert one row → the projection drops that edit.
    parent.querySelectorAll(".sc-ep-edit-revert")[0]!.dispatch("click", {});
    expect(session.size).toBe(1);
  });

  it("Undo removes the last edit and refreshes the count", () => {
    const { doc } = makeFakeDom();
    const { session, q } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    q(".sc-ep-ctl-font-size").value = "40";
    q(".sc-ep-ctl-font-size").dispatch("input", {});
    q(".sc-ep-ctl-color").value = "#111111";
    q(".sc-ep-ctl-color").dispatch("input", {});
    expect(session.size).toBe(2);
    q(".sc-ep-undo").dispatch("click", {});
    expect(session.size).toBe(1);
    expect(q(".sc-ep-count").textContent).toBe("1 edit");
  });

  it("Save fires onSave without mutating the buffer (the controller folds it in)", () => {
    const { doc } = makeFakeDom();
    const { session, q, state } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    q(".sc-ep-ctl-font-size").value = "40";
    q(".sc-ep-ctl-font-size").dispatch("input", {});
    q(".sc-ep-save").dispatch("click", {});
    expect(state.saved).toBe(true);
    expect(session.size).toBe(1);
  });

  it("shows NO 'Send to agent' button without the grant (guest / non-permitted)", () => {
    const { doc } = makeFakeDom();
    const { maybe } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    expect(maybe(".sc-ep-send")).toBeNull();
    expect(maybe(".sc-ep-save")).not.toBeNull(); // Save is always present
  });

  it("shows 'Send to agent' ALONGSIDE Save for a permitted member session (Phase 2)", () => {
    const { doc } = makeFakeDom();
    const { q, maybe, state } = mount({
      el: makeEl(doc, "h1", "Hero"),
      doc,
      canSendToAgent: true,
    });
    expect(maybe(".sc-ep-send")).not.toBeNull();
    expect(maybe(".sc-ep-save")).not.toBeNull();
    q(".sc-ep-send").dispatch("click", {});
    expect(state.sentToAgent).toBe(true);
  });
});

describe("PropertiesPanel — agent prompt field (U5, member-only, AE5)", () => {
  it("does not render the prompt field for a non-member session (default)", () => {
    const { doc } = makeFakeDom();
    const { maybe } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    expect(maybe(".sc-ep-prompt")).toBeNull();
  });

  it("does not render the prompt field when isMember is explicitly false (guest)", () => {
    const { doc } = makeFakeDom();
    const { maybe } = mount({ el: makeEl(doc, "h1", "Hero"), doc, isMember: false });
    expect(maybe(".sc-ep-prompt")).toBeNull();
  });

  it("renders the prompt field for a member session, independent of canSendToAgent", () => {
    const { doc } = makeFakeDom();
    const { maybe } = mount({ el: makeEl(doc, "h1", "Hero"), doc, isMember: true });
    expect(maybe(".sc-ep-prompt")).not.toBeNull();
    // Member-only gating, not also grant-gating: no send button, but the
    // prompt field is still present.
    expect(maybe(".sc-ep-send")).toBeNull();
  });

  it("captures typed text via onPromptChange on every keystroke", () => {
    const { doc } = makeFakeDom();
    const { q, state } = mount({ el: makeEl(doc, "h1", "Hero"), doc, isMember: true });
    const field = q(".sc-ep-prompt");
    field.value = "Make this pop";
    field.dispatch("input", {});
    expect(state.promptText).toBe("Make this pop");
  });

  it("pre-fills the field from getPromptText at construction (survives switching elements)", () => {
    const { doc } = makeFakeDom();
    const { q } = mount({
      el: makeEl(doc, "h1", "Hero"),
      doc,
      isMember: true,
      initialPromptText: "Earlier text",
    });
    expect(q(".sc-ep-prompt").value).toBe("Earlier text");
  });
});

describe("PropertiesPanel — teardown + contract", () => {
  it("× fires onClose", () => {
    const { doc } = makeFakeDom();
    const { q, state } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    q(".sc-ep-close").dispatch("click", {});
    expect(state.closed).toBe(true);
  });

  it("destroy() removes the panel and unbinds its listeners", () => {
    const { doc } = makeFakeDom();
    const { session, parent, q, panel } = mount({ el: makeEl(doc, "h1", "Hero"), doc });
    const fontSize = q(".sc-ep-ctl-font-size");
    fontSize.value = "40";
    fontSize.dispatch("input", {});
    expect(session.size).toBe(1);
    panel.destroy();
    expect(parent.querySelector(".sc-edit-panel")).toBeNull();
    // A change dispatched after teardown must NOT record a new op.
    fontSize.value = "80";
    fontSize.dispatch("input", {});
    expect(session.size).toBe(1);
  });

  it("every recorded op validates against changeOpSchema", () => {
    const { doc } = makeFakeDom();
    const { el } = withSiblings(doc, "div");
    const { session, q, segByText } = mount({ el, doc });
    segByText(".sc-ep-ctl-flex-direction", "Row").dispatch("click", {});
    q(".sc-ep-ctl-gap").value = "24";
    q(".sc-ep-ctl-gap").dispatch("input", {});
    q(".sc-ep-ctl-top").value = "8";
    q(".sc-ep-ctl-top").dispatch("input", {});
    q(".sc-ep-cross-center").dispatch("click", {});
    q(".sc-ep-move-up").dispatch("click", {});

    const ops: ChangeOp[] = session.list();
    expect(ops.length).toBeGreaterThanOrEqual(4);
    for (const op of ops) {
      expect(() => changeOpSchema.parse(op)).not.toThrow();
    }
  });
});

describe("colour helpers", () => {
  it("normalizeHex accepts #rgb, rrggbb, and bare input", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("123456")).toBe("#123456");
    expect(normalizeHex("  #FFFFFF ")).toBe("#ffffff");
    expect(normalizeHex("not-a-colour")).toBeNull();
  });

  it("rgbToHex converts rgb()/rgba() and passes through hex", () => {
    expect(rgbToHex("rgb(255, 0, 128)")).toBe("#ff0080");
    expect(rgbToHex("rgba(0, 16, 32, 0.5)")).toBe("#001020");
    expect(rgbToHex("#abcdef")).toBe("#abcdef");
    expect(rgbToHex(null)).toBeNull();
    expect(rgbToHex("transparent")).toBeNull();
  });
});
