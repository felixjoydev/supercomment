import { describe, it, expect, afterEach } from "vitest";

import {
  InspectorLayer,
  tagLabel,
  firstClass,
  dimsLabel,
  parseMarginPx,
  computeMarginPills,
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
});
