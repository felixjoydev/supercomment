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
    discard: () => session.discard(),
    count: () => session.size,
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
