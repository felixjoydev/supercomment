import { describe, it, expect } from "vitest";
import {
  clusterMarkers,
  partitionByViewport,
  DEFAULT_CLUSTER_THRESHOLD_PX,
  type MarkerInput,
} from "./cluster.js";
import { MarkerLayer } from "./render.js";
import { edgeDirection } from "../core/geometry.js";
import type { MarkerComment } from "../core/types.js";
import {
  makeFakeDom,
  makeRect,
  type FakeDocument,
} from "../test/dom-double.js";

function marker(n: number, x: number, y: number): MarkerInput {
  return { number: n, rect: makeRect(x, y, 0, 0) };
}

describe("clusterMarkers", () => {
  it("collapses two markers within the threshold into a count badge", () => {
    const clusters = clusterMarkers(
      [marker(1, 100, 100), marker(2, 110, 105)],
      DEFAULT_CLUSTER_THRESHOLD_PX,
    );
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.isCluster).toBe(true);
    expect(clusters[0]!.numbers).toEqual([1, 2]);
  });

  it("keeps far-apart markers as separate single pins", () => {
    const clusters = clusterMarkers(
      [marker(1, 0, 0), marker(2, 500, 500)],
      DEFAULT_CLUSTER_THRESHOLD_PX,
    );
    expect(clusters.length).toBe(2);
    expect(clusters.every((c) => !c.isCluster)).toBe(true);
  });
});

describe("partitionByViewport / edgeDirection", () => {
  it("flags an off-screen target and yields a pointing direction", () => {
    const viewport = { width: 1000, height: 800 };
    const { visible, offscreen } = partitionByViewport(
      [marker(1, 500, 400), marker(2, 1200, 400)],
      viewport,
    );
    expect(visible.map((m) => m.number)).toEqual([1]);
    expect(offscreen.map((m) => m.number)).toEqual([2]);
    expect(edgeDirection(offscreen[0]!.point, viewport)).toBe("right");
  });

  it("returns a diagonal direction for a corner-offscreen point", () => {
    expect(
      edgeDirection({ x: -50, y: -50 }, { width: 1000, height: 800 }),
    ).toBe("top-left");
  });
});

describe("MarkerLayer rendering", () => {
  function setup(): { doc: FakeDocument; layer: MarkerLayer; parent: any } {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    doc.body.appendChild(parent);
    const layer = new MarkerLayer(doc as unknown as Document, parent as any);
    return { doc, layer, parent };
  }

  it("renders one pin per distinct on-screen marker", () => {
    const { layer } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0) });
    layer.add({ number: 2, rect: makeRect(500, 500, 0, 0) });
    layer.render({ width: 1000, height: 800 });
    expect(layer.renderedPinCount()).toBe(2);
    expect(layer.renderedEdgeCount()).toBe(0);
  });

  it("renders a single cluster badge for two nearby markers", () => {
    const { layer } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0) });
    layer.add({ number: 2, rect: makeRect(108, 104, 0, 0) });
    layer.render({ width: 1000, height: 800 });
    expect(layer.renderedPinCount()).toBe(1);
  });

  it("renders an edge indicator for an off-screen marker", () => {
    const { layer } = setup();
    layer.add({ number: 1, rect: makeRect(2000, 100, 0, 0) });
    layer.render({ width: 1000, height: 800 });
    expect(layer.renderedPinCount()).toBe(0);
    expect(layer.renderedEdgeCount()).toBe(1);
  });
});

describe("MarkerLayer existing comments (U12)", () => {
  function setup(): { layer: MarkerLayer; parent: any } {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    doc.body.appendChild(parent);
    const layer = new MarkerLayer(doc as unknown as Document, parent as any);
    return { layer, parent };
  }

  it("addMany renders a pin per existing comment in one paint", () => {
    const { layer } = setup();
    layer.addMany([
      { number: 1, rect: makeRect(100, 100, 0, 0) },
      { number: 2, rect: makeRect(500, 500, 0, 0), isStale: true },
    ]);
    layer.render({ width: 1000, height: 800 });
    expect(layer.count()).toBe(2);
    expect(layer.renderedPinCount()).toBe(2);
  });

  it("addMany of an empty list paints nothing (clean empty render)", () => {
    const { layer } = setup();
    layer.addMany([]);
    expect(layer.count()).toBe(0);
    expect(layer.renderedPinCount()).toBe(0);
  });

  it("renders a stale existing comment with the sc-stale class", () => {
    const { layer, parent } = setup();
    layer.addMany([
      { number: 1, rect: makeRect(100, 100, 0, 0), isStale: false },
      { number: 2, rect: makeRect(500, 500, 0, 0), isStale: true },
    ]);
    layer.render({ width: 1000, height: 800 });
    const stale = parent.querySelectorAll(".sc-marker.sc-stale");
    expect(stale.length).toBe(1);
    expect(stale[0]!.textContent).toBe("2");
  });
});

describe("MarkerLayer comment popover (U12)", () => {
  function setup(): { layer: MarkerLayer; parent: any } {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    doc.body.appendChild(parent);
    const layer = new MarkerLayer(doc as unknown as Document, parent as any);
    return { layer, parent };
  }

  const content = (over: Partial<MarkerComment> = {}): MarkerComment => ({
    note: "Make the header bigger",
    authorDisplayName: "Ada",
    intent: "change",
    severity: "important",
    status: "open",
    createdAt: "",
    ...over,
  });

  // The delegated click listener lives on the container; in a real DOM a click on
  // a pin bubbles up to it with e.target = the pin. The DOM double does not
  // bubble, so dispatch on the container with the pin as the event target.
  function clickPin(parent: any, pin: any): void {
    parent
      .querySelector(".sc-marker-container")!
      .dispatch("click", { target: pin });
  }

  it("opens a popover with the note + author when a pin is clicked", () => {
    const { layer, parent } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0), content: content() });
    layer.render({ width: 1000, height: 800 });

    expect(layer.hasOpenPopover()).toBe(false);
    clickPin(parent, parent.querySelectorAll(".sc-marker")[0]!);

    const pop = parent.querySelector(".sc-comment-pop");
    expect(pop).not.toBeNull();
    expect(layer.hasOpenPopover()).toBe(true);
    expect(pop!.textContent).toContain("Make the header bigger");
    expect(pop!.textContent).toContain("Ada");
    expect(pop!.textContent).toContain("#1");
  });

  it("clicking the same pin again closes the popover", () => {
    const { layer, parent } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0), content: content() });
    layer.render({ width: 1000, height: 800 });
    const pin = parent.querySelectorAll(".sc-marker")[0]!;

    clickPin(parent, pin);
    expect(layer.hasOpenPopover()).toBe(true);
    clickPin(parent, pin);
    expect(layer.hasOpenPopover()).toBe(false);
    expect(parent.querySelector(".sc-comment-pop")).toBeNull();
  });

  it("closePopover() removes the open popover", () => {
    const { layer, parent } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0), content: content() });
    layer.render({ width: 1000, height: 800 });
    clickPin(parent, parent.querySelectorAll(".sc-marker")[0]!);
    expect(layer.hasOpenPopover()).toBe(true);

    layer.closePopover();
    expect(layer.hasOpenPopover()).toBe(false);
    expect(parent.querySelector(".sc-comment-pop")).toBeNull();
  });

  it("clicking a second pin switches the popover content", () => {
    const { layer, parent } = setup();
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 0, 0),
      content: content({ note: "First note", authorDisplayName: "Ada" }),
    });
    layer.add({
      number: 2,
      rect: makeRect(600, 500, 0, 0),
      content: content({ note: "Second note", authorDisplayName: "Grace" }),
    });
    layer.render({ width: 1000, height: 800 });

    const pins = parent.querySelectorAll(".sc-marker");
    const pin1 = pins.find((p: any) => p.getAttribute("data-numbers") === "1")!;
    const pin2 = pins.find((p: any) => p.getAttribute("data-numbers") === "2")!;

    clickPin(parent, pin1);
    expect(parent.querySelector(".sc-comment-pop")!.textContent).toContain(
      "First note",
    );

    clickPin(parent, pin2);
    // Exactly one popover, now showing the second comment's content.
    expect(parent.querySelectorAll(".sc-comment-pop").length).toBe(1);
    const pop = parent.querySelector(".sc-comment-pop")!;
    expect(pop.textContent).toContain("Second note");
    expect(pop.textContent).toContain("Grace");
    expect(pop.textContent).not.toContain("First note");
  });
});

describe("MarkerLayer — template treatment (U16/R11)", () => {
  it("renders a distinct template pin and tags its popover", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(doc as unknown as Document, parent as unknown as HTMLElement);
    const content: MarkerComment = {
      note: "Make the hero bigger",
      authorDisplayName: "Alex",
      kind: "template",
    };
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0), content });

    expect(parent.querySelector(".sc-marker.sc-template")).not.toBeNull();

    layer.showPopover([1], { x: 100, y: 100 });
    const tag = parent.querySelector(".sc-comment-tag");
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toContain("Template");
  });

  it("keeps an ordinary comment pin plain (no template class/tag)", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(doc as unknown as Document, parent as unknown as HTMLElement);
    layer.add({
      number: 2,
      rect: makeRect(100, 100, 0, 0),
      content: { note: "Ordinary", authorDisplayName: "Sam" },
    });
    expect(parent.querySelector(".sc-marker.sc-template")).toBeNull();
    expect(parent.querySelector(".sc-marker")).not.toBeNull();
    layer.showPopover([2], { x: 100, y: 100 });
    expect(parent.querySelector(".sc-comment-tag")).toBeNull();
  });
});
