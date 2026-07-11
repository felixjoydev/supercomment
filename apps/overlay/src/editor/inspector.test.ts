import { describe, it, expect, afterEach } from "vitest";

import {
  InspectorLayer,
  tagLabel,
  firstClass,
  dimsLabel,
  parseMarginPx,
  computeMarginPills,
  computeDistancePills,
} from "./inspector.js";
import {
  makeFakeDom,
  setRectProvider,
  makeRect,
  type FakeElement,
} from "../test/dom-double.js";

afterEach(() => setRectProvider(() => makeRect(0, 0, 10, 10)));

describe("inspector pure helpers", () => {
  it("tagLabel wraps the lowercased tag in angle brackets", () => {
    const { doc } = makeFakeDom();
    expect(tagLabel(doc.createElement("H2") as unknown as Element)).toBe("<h2>");
    expect(tagLabel(doc.createElement("div") as unknown as Element)).toBe("<div>");
  });

  it("firstClass returns the first class token or empty", () => {
    const { doc } = makeFakeDom();
    const el = doc.createElement("div");
    el.className = "hero  primary";
    expect(firstClass(el as unknown as Element)).toBe("hero");
    expect(firstClass(doc.createElement("div") as unknown as Element)).toBe("");
  });

  it("dimsLabel combines the class + rounded dimensions", () => {
    const { doc } = makeFakeDom();
    const el = doc.createElement("div");
    el.className = "hero";
    expect(dimsLabel(el as unknown as Element, { x: 0, y: 0, width: 1228.4, height: 44 })).toBe(
      ".hero · 1228 × 44",
    );
    const plain = doc.createElement("div");
    expect(dimsLabel(plain as unknown as Element, { x: 0, y: 0, width: 100, height: 20 })).toBe(
      "100 × 20",
    );
  });

  it("parseMarginPx returns a non-negative integer, 0 on failure", () => {
    expect(parseMarginPx("48px")).toBe(48);
    expect(parseMarginPx("0px")).toBe(0);
    expect(parseMarginPx("-8px")).toBe(0);
    expect(parseMarginPx(null)).toBe(0);
    expect(parseMarginPx("auto")).toBe(0);
  });

  it("computeMarginPills places a pill at the middle of each non-zero margin band", () => {
    const rect = { x: 100, y: 200, width: 200, height: 100 };
    const pills = computeMarginPills(rect, { top: 40, right: 0, bottom: 48, left: 20 });
    const bySide = Object.fromEntries(pills.map((p) => [p.side, p]));
    expect(pills).toHaveLength(3); // right = 0 → no pill
    expect(bySide.top).toMatchObject({ value: 40, x: 200, y: 180 }); // cx, y-20
    expect(bySide.bottom).toMatchObject({ value: 48, x: 200, y: 324 }); // cx, y+h+24
    expect(bySide.left).toMatchObject({ value: 20, x: 90, y: 250 }); // x-10, cy
  });

  it("computeDistancePills measures the gap between nearest edges (R11)", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    // b sits 50px to the right, vertically aligned → one x-axis pill, no y pill.
    expect(computeDistancePills(a, { x: 150, y: 0, width: 50, height: 100 })).toEqual([
      { axis: "x", value: 50, x: 125, y: 50 },
    ]);
    // b below and to the right → both a horizontal and a vertical gap.
    const pills = computeDistancePills(a, { x: 120, y: 140, width: 40, height: 40 });
    expect(pills.map((p) => [p.axis, p.value])).toEqual([
      ["x", 20],
      ["y", 40],
    ]);
    // Overlapping on both axes → no gap pills.
    expect(computeDistancePills(a, { x: 10, y: 10, width: 50, height: 50 })).toEqual([]);
  });
});

describe("InspectorLayer", () => {
  function mount() {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const inspector = new InspectorLayer(doc as unknown as Document, parent as unknown as HTMLElement);
    const q = (sel: string): FakeElement | null => parent.querySelector(sel);
    return { doc, parent, inspector, q };
  }

  it("draws a box, tag badge, and dims label for the shown element", () => {
    setRectProvider(() => makeRect(20, 30, 300, 50));
    const { doc, inspector, q } = mount();
    const el = doc.createElement("h2");
    el.className = "title";
    inspector.show(el as unknown as Element);
    expect(q(".sc-inspect-box")).not.toBeNull();
    expect(q(".sc-inspect-tag")!.textContent).toBe("<h2>");
    expect(q(".sc-inspect-dims")!.textContent).toBe(".title · 300 × 50");
    expect(inspector.isActive()).toBe(true);
  });

  it("hide() clears the overlay", () => {
    const { doc, inspector, q } = mount();
    inspector.show(doc.createElement("div") as unknown as Element);
    inspector.hide();
    expect(q(".sc-inspect-box")).toBeNull();
    expect(inspector.isActive()).toBe(false);
  });

  it("never throws for an unmeasurable element", () => {
    const { inspector } = mount();
    expect(() => inspector.show({ tagName: "DIV" } as unknown as Element)).not.toThrow();
  });

  it("keeps chrome node identity stable across 100 re-renders (no churn, U4)", () => {
    setRectProvider(() => makeRect(0, 0, 100, 50));
    const { doc, inspector, q } = mount();
    inspector.show(doc.createElement("div") as unknown as Element);
    const box = q(".sc-inspect-box");
    for (let i = 0; i < 100; i++) inspector.render();
    expect(q(".sc-inspect-box")).toBe(box); // same node object, repositioned only
  });

  it("updates the size badge immediately when an edit changes geometry (R4)", () => {
    setRectProvider(() => makeRect(0, 0, 300, 50));
    const { doc, inspector, q } = mount();
    const el = doc.createElement("div");
    inspector.show(el as unknown as Element);
    expect(q(".sc-inspect-dims")!.textContent).toBe("300 × 50");
    // An edit widened the element; a re-render (driven by a history event) reflects
    // it without a scroll.
    setRectProvider(() => makeRect(0, 0, 500, 50));
    inspector.render();
    expect(q(".sc-inspect-dims")!.textContent).toBe("500 × 50");
    expect(q(".sc-inspect-box")!.style.width).toBe("500px");
  });

  it("draws hover distance pills between the selection and a hovered sibling (R11)", () => {
    setRectProvider((el) =>
      el.id === "sel" ? makeRect(0, 0, 100, 100) : makeRect(150, 0, 50, 100),
    );
    const { doc, inspector, parent } = mount();
    const sel = doc.createElement("div");
    sel.id = "sel";
    const other = doc.createElement("div");
    other.id = "other";
    inspector.show(sel as unknown as Element);
    inspector.measureTo(other as unknown as Element);
    const pills = parent.querySelectorAll(".sc-inspect-measure");
    expect(pills.length).toBe(1);
    expect(pills[0]!.textContent).toBe("50"); // 150 - (0 + 100)
    // Clearing the hover removes the measurement.
    inspector.clearHover();
    expect(
      parent.querySelectorAll(".sc-inspect-measure").filter((p) => p.style.display !== "none"),
    ).toHaveLength(0);
  });

  it("rAF-batches scheduled re-renders during a gesture (U4)", () => {
    const { doc, inspector } = mount();
    const queue: Array<() => void> = [];
    (doc.defaultView as unknown as { requestAnimationFrame: (cb: () => void) => void })
      .requestAnimationFrame = (cb) => {
      queue.push(cb);
    };
    inspector.show(doc.createElement("div") as unknown as Element);
    inspector.scheduleRender();
    inspector.scheduleRender();
    inspector.scheduleRender();
    expect(queue.length).toBe(1); // three schedules coalesced into one frame
    queue[0]!(); // flush the frame
    inspector.scheduleRender();
    expect(queue.length).toBe(2); // a new frame can be scheduled after the flush
  });
});

describe("InspectorLayer resize handles (U12)", () => {
  function mount(metrics = { offsetWidth: 200, offsetHeight: 100, clientRectCount: 1, display: "block" }) {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const committed: { width: number; height: number }[] = [];
    const inspector = new InspectorLayer(doc as unknown as Document, parent as unknown as HTMLElement, {
      onResizeCommit: (d) => committed.push(d),
      readMetrics: () => metrics,
    });
    const q = (sel: string): FakeElement | null => parent.querySelector(sel);
    return { doc, parent, inspector, committed, q };
  }

  it("records a handle drag as width+height, correcting for ancestor scale", () => {
    // rect 100x50 but layout 200x100 → scale 0.5. Drag +50 viewport px east → +100 css.
    setRectProvider(() => makeRect(0, 0, 100, 50));
    const { doc, inspector, committed, q } = mount();
    const el = doc.createElement("div");
    inspector.show(el as unknown as Element, { resizable: true });
    const eHandle = q(".sc-inspect-handle-e")!;
    eHandle.dispatch("pointerdown", {
      clientX: 100, clientY: 25, pointerId: 1, target: eHandle,
      preventDefault() {}, stopPropagation() {},
    });
    (doc as unknown as FakeElement).dispatch("pointermove", { clientX: 150, clientY: 25 });
    (doc as unknown as FakeElement).dispatch("pointerup", { clientX: 150, clientY: 25 });
    expect(committed).toEqual([{ width: 300, height: 100 }]);
  });

  it("pointercancel mid-drag records nothing (restores the pre-gesture size)", () => {
    setRectProvider(() => makeRect(0, 0, 200, 100));
    const { doc, inspector, committed, q } = mount();
    const el = doc.createElement("div");
    inspector.show(el as unknown as Element, { resizable: true });
    const se = q(".sc-inspect-handle-se")!;
    se.dispatch("pointerdown", { clientX: 200, clientY: 100, pointerId: 1, target: se, preventDefault() {}, stopPropagation() {} });
    (doc as unknown as FakeElement).dispatch("pointermove", { clientX: 250, clientY: 130 });
    expect(inspector.isResizing()).toBe(true);
    (doc as unknown as FakeElement).dispatch("pointercancel", {});
    expect(inspector.isResizing()).toBe(false);
    expect(committed).toEqual([]);
  });

  it("hides the handles in passive (non-resizable) mode and for inapplicable boxes", () => {
    setRectProvider(() => makeRect(0, 0, 200, 100));
    const passive = mount();
    passive.inspector.show(passive.doc.createElement("div") as unknown as Element); // no resizable
    expect(passive.q(".sc-inspect-handle-e")!.style.display).toBe("none");

    const inline = mount({ offsetWidth: 200, offsetHeight: 20, clientRectCount: 2, display: "inline" });
    inline.inspector.show(inline.doc.createElement("span") as unknown as Element, { resizable: true });
    expect(inline.q(".sc-inspect-handle-e")!.style.display).toBe("none");
  });
});
