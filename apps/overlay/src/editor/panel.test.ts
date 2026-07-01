import { describe, it, expect } from "vitest";

import { changeOpSchema, type ChangeOp } from "@supercomment/shared";

import {
  makeFakeDom,
  type FakeDocument,
  type FakeElement,
} from "../test/dom-double.js";
import { PropertiesPanel, type PanelCallbacks } from "./panel.js";
import { EditSession } from "./edit-session.js";
import { buildEditTarget } from "./edit-target.js";

// The panel is exercised against its REAL collaborator — a live EditSession —
// so these are integration tests over the exact wiring the controller uses.

function makeLeaf(doc: FakeDocument, tag: string, text: string): FakeElement {
  const el = doc.createElement(tag);
  el.textContent = text;
  doc.body.appendChild(el);
  return el;
}

function mount(opts?: { el?: FakeElement; doc?: FakeDocument }) {
  const { doc } = opts?.doc ? { doc: opts.doc } : makeFakeDom();
  const parent = doc.createElement("div"); // stands in for shell.layer
  const el = opts?.el ?? makeLeaf(doc, "button", "Buy");
  const session = new EditSession();
  const state = { closed: false };
  const cb: PanelCallbacks = {
    record: (op) => session.record(op),
    revert: (op) => session.remove(op),
    discard: () => session.discard(),
    count: () => session.size,
    onClose: () => {
      state.closed = true;
    },
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
  const btnByLabel = (label: string): FakeElement => {
    const btn = parent.querySelectorAll(".sc-ep-btn").find((b) => b.textContent === label);
    if (!btn) throw new Error(`no button "${label}"`);
    return btn;
  };
  return { doc, parent, el, session, panel, state, q, btnByLabel };
}

describe("PropertiesPanel — mount", () => {
  it("mounts the inspector with style + structure controls", () => {
    const { parent } = mount();
    expect(parent.querySelector(".sc-edit-panel")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-font-size")).not.toBeNull();
    expect(parent.querySelector(".sc-ep-ctl-color")).not.toBeNull();
    // Structure actions render.
    expect(parent.querySelectorAll(".sc-ep-btn").length).toBeGreaterThanOrEqual(4);
  });

  it("offers the text control for a leaf but not for an element with children", () => {
    const leaf = mount();
    expect(leaf.parent.querySelector(".sc-ep-textarea")).not.toBeNull();

    const { doc } = makeFakeDom();
    const div = doc.createElement("div");
    div.appendChild(doc.createElement("span"));
    doc.body.appendChild(div);
    const nonLeaf = mount({ el: div, doc });
    expect(nonLeaf.parent.querySelector(".sc-ep-textarea")).toBeNull();
  });
});

describe("PropertiesPanel — content & style edits (R2)", () => {
  it("records a setStyle op with before→after when a number control changes", () => {
    const { session, q } = mount();
    const input = q(".sc-ep-ctl-font-size");
    input.value = "48";
    input.dispatch("input", {});

    expect(session.size).toBe(1);
    const op = session.list()[0]!;
    expect(op.type).toBe("setStyle");
    expect(op.property).toBe("font-size");
    expect(op.after).toBe("48px");
    // Target carries a selector + anchors for re-resolution.
    expect(op.target.selector.length).toBeGreaterThan(0);
  });

  it("records a select (font-weight) change", () => {
    const { session, q } = mount();
    const select = q(".sc-ep-ctl-font-weight");
    select.value = "700";
    select.dispatch("change", {});
    const op = session.list()[0]!;
    expect(op.type).toBe("setStyle");
    expect(op.property).toBe("font-weight");
    expect(op.after).toBe("700");
  });

  it("coalesces repeated nudges of one property into a single edit", () => {
    const { session, q } = mount();
    const input = q(".sc-ep-ctl-font-size");
    input.value = "40";
    input.dispatch("input", {});
    input.value = "52";
    input.dispatch("input", {});
    expect(session.size).toBe(1);
    expect(session.list()[0]!.after).toBe("52px");
  });

  it("records a normalized setText edit and previews it on the element", () => {
    const { session, el, q } = mount();
    const textarea = q(".sc-ep-textarea");
    textarea.value = "  New   copy ";
    textarea.dispatch("input", {});
    const op = session.list()[0]!;
    expect(op.type).toBe("setText");
    expect(op.after).toBe("New copy"); // whitespace-collapsed
    expect(el.textContent).toBe("  New   copy "); // ephemeral preview applied verbatim
  });
});

describe("PropertiesPanel — structural edits (R3)", () => {
  it("hide then show coalesces to a net no-op in the buffer", () => {
    const { session, btnByLabel } = mount();
    btnByLabel("Hide").dispatch("click", {});
    expect(session.size).toBe(1);
    expect(session.list()[0]!.type).toBe("setVisibility");
    // The button flips to "Show"; clicking it cancels the hide.
    btnByLabel("Show").dispatch("click", {});
    expect(session.isEmpty()).toBe(true);
  });

  it("delete records removeNode and undo reverts it (reversible in the buffer)", () => {
    const { session, btnByLabel } = mount();
    btnByLabel("Delete").dispatch("click", {});
    expect(session.list().some((o) => o.type === "removeNode")).toBe(true);
    btnByLabel("Undo delete").dispatch("click", {});
    expect(session.isEmpty()).toBe(true);
  });

  it("reorder records a moveNode with a parent anchor + indices", () => {
    const { doc } = makeFakeDom();
    const container = doc.createElement("section");
    doc.body.appendChild(container);
    const a = doc.createElement("div");
    const b = doc.createElement("div");
    const c = doc.createElement("div");
    a.textContent = "A";
    b.textContent = "B";
    c.textContent = "C";
    container.append(a, b, c);

    const { session, btnByLabel } = mount({ el: b, doc });
    btnByLabel("Move up").dispatch("click", {});
    const op = session.list().find((o) => o.type === "moveNode")!;
    expect(op).toBeTruthy();
    expect(op.order).toEqual({ from: 1, to: 0 });
    expect(op.insertion?.parent).toBeTruthy();
    expect(op.insertion?.position).toBe("before");
  });

  it("insert records an insertNode with an insertion point + semantic node (AE5)", () => {
    const { doc } = makeFakeDom();
    const container = doc.createElement("section");
    doc.body.appendChild(container);
    const anchor = doc.createElement("p");
    anchor.textContent = "Existing";
    container.appendChild(anchor);

    const { session, parent } = mount({ el: anchor, doc });
    const tag = parent.querySelector(".sc-ep-insert-tag")!;
    tag.value = "button";
    const text = parent.querySelector(".sc-ep-insert-text")!;
    text.value = "Sign up";
    parent.querySelector(".sc-ep-insert-add")!.dispatch("click", {});

    const op = session.list().find((o) => o.type === "insertNode")!;
    expect(op).toBeTruthy();
    expect(op.node).toEqual({ tag: "button", text: "Sign up" });
    expect(op.insertion?.position).toBe("after");
    expect(op.insertion?.reference).toBeTruthy();
    // A ghost preview node was injected (best-effort; ours, safe to remove).
    expect(container.children.length).toBe(2);
  });
});

describe("PropertiesPanel — discard & teardown (G13/R7, plans/008)", () => {
  it("requires an explicit two-step confirm to discard the buffer", () => {
    const { session, q } = mount();
    q(".sc-ep-ctl-font-size").value = "40";
    q(".sc-ep-ctl-font-size").dispatch("input", {});
    expect(session.size).toBe(1);

    const discard = q(".sc-ep-discard");
    discard.dispatch("click", {}); // arms only
    expect(session.size).toBe(1);
    expect(discard.textContent).toBe("Confirm discard?");
    discard.dispatch("click", {}); // confirms
    expect(session.isEmpty()).toBe(true);
  });

  it("destroy() removes the panel and unbinds its listeners", () => {
    const { session, parent, q, panel } = mount();
    const fontSize = q(".sc-ep-ctl-font-size");
    fontSize.value = "40";
    fontSize.dispatch("input", {});
    expect(session.size).toBe(1);

    const color = q(".sc-ep-ctl-color");
    panel.destroy();
    expect(parent.querySelector(".sc-edit-panel")).toBeNull();

    // A change dispatched after teardown must NOT record a new op.
    color.value = "#ff0000";
    color.dispatch("input", {});
    expect(session.size).toBe(1);
  });
});

describe("PropertiesPanel — contract", () => {
  it("every recorded op validates against changeOpSchema", () => {
    const { session, q, btnByLabel } = mount();
    q(".sc-ep-ctl-font-size").value = "48";
    q(".sc-ep-ctl-font-size").dispatch("input", {});
    q(".sc-ep-ctl-color").value = "#123456";
    q(".sc-ep-ctl-color").dispatch("input", {});
    q(".sc-ep-textarea").value = "Hello";
    q(".sc-ep-textarea").dispatch("input", {});
    btnByLabel("Hide").dispatch("click", {});

    const ops: ChangeOp[] = session.list();
    expect(ops.length).toBeGreaterThanOrEqual(3);
    for (const op of ops) {
      expect(() => changeOpSchema.parse(op)).not.toThrow();
    }
  });
});
