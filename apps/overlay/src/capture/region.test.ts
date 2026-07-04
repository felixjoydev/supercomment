import { describe, expect, it, vi } from "vitest";

import {
  CROP_PAD_MAX_PX,
  CROP_PAD_MIN_PX,
  MIN_CROP_PX,
  cropBox,
  createRegionRasterizer,
  excludeOverlayHost,
  type DomToCanvas,
} from "./region.js";
import { HOST_ELEMENT_ID } from "../shell/root.js";

describe("cropBox", () => {
  it("pads a small target by the floor margin and adds the scroll offset", () => {
    // 50x20 * 0.3 = 15x6, both below the floor -> both pad = CROP_PAD_MIN_PX.
    const box = cropBox({ x: 100, y: 200, width: 50, height: 20 }, 30, 40);
    expect(box).toEqual({
      x: 100 + 30 - CROP_PAD_MIN_PX,
      y: 200 + 40 - CROP_PAD_MIN_PX,
      width: 50 + CROP_PAD_MIN_PX * 2,
      height: 20 + CROP_PAD_MIN_PX * 2,
    });
  });

  it("scales the context margin with the target size", () => {
    // 500x400 * 0.3 = 150x120, both between the floor and cap -> proportional.
    const box = cropBox({ x: 0, y: 0, width: 500, height: 400 }, 0, 0);
    expect(box.width).toBe(500 + 150 * 2);
    expect(box.height).toBe(400 + 120 * 2);
  });

  it("caps the context margin for a very large target", () => {
    // 1000 * 0.3 = 300 -> capped at CROP_PAD_MAX_PX.
    const box = cropBox({ x: 500, y: 500, width: 1000, height: 1000 }, 0, 0);
    expect(box.width).toBe(1000 + CROP_PAD_MAX_PX * 2);
    expect(box.height).toBe(1000 + CROP_PAD_MAX_PX * 2);
  });

  it("still gives a zero-size target real context and never goes negative", () => {
    const box = cropBox({ x: 2, y: 2, width: 0, height: 0 }, 0, 0);
    expect(box.width).toBe(CROP_PAD_MIN_PX * 2);
    expect(box.width).toBeGreaterThanOrEqual(MIN_CROP_PX);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });
});

describe("excludeOverlayHost", () => {
  it("excludes ONLY the overlay host element", () => {
    expect(excludeOverlayHost({ nodeType: 1, id: HOST_ELEMENT_ID } as never)).toBe(
      false,
    );
    expect(excludeOverlayHost({ nodeType: 1, id: "app" } as never)).toBe(true);
    // A text node (nodeType 3) is never the host.
    expect(excludeOverlayHost({ nodeType: 3 } as never)).toBe(true);
  });
});

/** Build a minimal DOM double sufficient for the region rasterizer. */
function fakeEnv(opts: {
  srcW?: number;
  srcH?: number;
  clientW?: number;
  dpr?: number;
  scrollX?: number;
  scrollY?: number;
  canvasW?: number;
  canvasH?: number;
}) {
  const ctx = {
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
  };
  const outCanvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => "data:image/png;base64,AAAAfake",
  };
  const src = {
    nodeType: 1,
    scrollWidth: opts.srcW ?? 1200,
    scrollHeight: opts.srcH ?? 3000,
    clientWidth: opts.clientW ?? 1200,
  };
  const doc = {
    scrollingElement: src,
    documentElement: src,
    createElement: (_tag: string) => outCanvas,
    get defaultView() {
      return view;
    },
  };
  const view = {
    devicePixelRatio: opts.dpr ?? 1,
    scrollX: opts.scrollX ?? 0,
    scrollY: opts.scrollY ?? 0,
  };
  const element = { ownerDocument: doc } as unknown as Element;
  const sourceCanvas = {
    width: opts.canvasW ?? opts.srcW ?? 1200,
    height: opts.canvasH ?? opts.srcH ?? 3000,
  } as unknown as HTMLCanvasElement;
  return { ctx, outCanvas, src, doc, view, element, sourceCanvas };
}

describe("createRegionRasterizer", () => {
  it("rasters the page with the security + hide-overlay options, then crops and marks", async () => {
    const env = fakeEnv({ dpr: 2, canvasW: 2400, srcW: 1200 });
    let seenOptions: Record<string, unknown> | undefined;
    const serialize: DomToCanvas = vi.fn(async (node, options) => {
      expect(node).toBe(env.src);
      seenOptions = options as Record<string, unknown>;
      return env.sourceCanvas;
    });

    const raster = createRegionRasterizer(serialize);
    const url = await raster({
      rect: { x: 100, y: 150, width: 80, height: 24 },
      element: env.element,
    });

    expect(url).toBe("data:image/png;base64,AAAAfake");
    // G1 field-blanking hook + hide-overlay filter + white bg are all wired.
    expect(seenOptions?.onCloneEachNode).toBeTypeOf("function");
    expect(seenOptions?.filter).toBe(excludeOverlayHost);
    expect(seenOptions?.backgroundColor).toBe("#ffffff");
    // Cropped from the source canvas and the target outlined (eff scale = 2400/1200 = 2).
    expect(env.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(env.ctx.strokeRect).toHaveBeenCalledTimes(1);
    expect(env.outCanvas.width).toBeGreaterThan(0);
  });

  it("marks a zero-size target with a dot instead of a hairline rectangle", async () => {
    const env = fakeEnv({});
    const serialize: DomToCanvas = async () => env.sourceCanvas;
    const raster = createRegionRasterizer(serialize);
    const url = await raster({
      rect: { x: 10, y: 10, width: 0, height: 0 },
      element: env.element,
    });
    expect(url).toContain("data:image/png");
    expect(env.ctx.arc).toHaveBeenCalledTimes(1);
    expect(env.ctx.strokeRect).not.toHaveBeenCalled();
  });

  it("clamps the scale so a very tall page cannot exceed the canvas limit", async () => {
    const env = fakeEnv({ srcW: 1000, srcH: 40000, dpr: 2, canvasW: 500 });
    let scale: number | undefined;
    const serialize: DomToCanvas = async (_n, options) => {
      scale = (options as { scale?: number }).scale;
      return env.sourceCanvas;
    };
    await createRegionRasterizer(serialize)({
      rect: { x: 0, y: 0, width: 10, height: 10 },
      element: env.element,
    });
    // min(dpr=2, 8192/1000, 8192/40000=0.20) -> 0.20, floored to the 0.5 minimum.
    expect(scale).toBe(0.5);
  });

  it("resolves null (never throws) when the serializer fails", async () => {
    const env = fakeEnv({});
    const serialize: DomToCanvas = async () => {
      throw new Error("canvas taint");
    };
    const raster = createRegionRasterizer(serialize);
    await expect(
      raster({ rect: { x: 0, y: 0, width: 10, height: 10 }, element: env.element }),
    ).resolves.toBeNull();
  });

  it("resolves null when the raster returns an empty canvas", async () => {
    const env = fakeEnv({ canvasW: 0, canvasH: 0 });
    const serialize: DomToCanvas = async () => env.sourceCanvas;
    const raster = createRegionRasterizer(serialize);
    await expect(
      raster({ rect: { x: 0, y: 0, width: 10, height: 10 }, element: env.element }),
    ).resolves.toBeNull();
  });
});
