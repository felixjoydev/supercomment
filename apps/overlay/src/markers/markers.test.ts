import { describe, it, expect } from "vitest";
import {
  clusterMarkers,
  partitionByViewport,
  DEFAULT_CLUSTER_THRESHOLD_PX,
  type MarkerInput,
} from "./cluster.js";
import { MarkerLayer } from "./render.js";
import { edgeDirection } from "../core/geometry.js";
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
