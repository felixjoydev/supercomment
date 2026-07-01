import { describe, it, expect } from "vitest";

import { createLiveRasterizer, type DomToPng } from "./rasterize-live.js";

const el = (tag: string, attrs: Record<string, string> = {}): Element =>
  ({
    tagName: tag.toUpperCase(),
    getAttribute: (n: string) => attrs[n] ?? null,
  }) as unknown as Element;

describe("createLiveRasterizer", () => {
  it("returns the serializer's PNG data URL", async () => {
    const rasterize = createLiveRasterizer(async () => "data:image/png;base64,AAAA");
    expect(await rasterize(el("div"))).toBe("data:image/png;base64,AAAA");
  });

  it("returns null when the serializer throws (→ DOM-snapshot fallback)", async () => {
    const rasterize = createLiveRasterizer(async () => {
      throw new Error("canvas tainted (cross-origin)");
    });
    expect(await rasterize(el("div"))).toBeNull();
  });

  it("returns null for a non-image result", async () => {
    const rasterize = createLiveRasterizer(async () => "");
    expect(await rasterize(el("div"))).toBeNull();
  });

  it("drops password inputs but keeps other nodes (G1 filter)", async () => {
    let filter: ((n: Node) => boolean) | undefined;
    const serialize: DomToPng = async (_node, opts) => {
      filter = opts?.filter;
      return "data:image/png;base64,AAAA";
    };
    await createLiveRasterizer(serialize)(el("section"));

    expect(filter).toBeDefined();
    expect(filter!(el("input", { type: "password" }) as unknown as Node)).toBe(false);
    expect(filter!(el("input", { type: "text" }) as unknown as Node)).toBe(true);
    expect(filter!(el("div") as unknown as Node)).toBe(true);
  });
});
