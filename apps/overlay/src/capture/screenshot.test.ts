import { describe, it, expect, vi } from "vitest";

import {
  captureScreenshot,
  attachBeforeArtifact,
  encodeSnapshotArtifact,
  BEFORE_ARTIFACT_SNAPSHOT_PREFIX,
} from "./screenshot.js";

/**
 * Tests for the per-comment, element-scoped "before" artifact (U9, R15).
 *
 * Two doubles are used:
 *  - `anyEl()` — an opaque element stand-in for tests that inject the raster /
 *    snapshot seams (the element is never actually walked).
 *  - `serializableEl()` — a minimal element matching the snapshot serializer's
 *    surface (NamedNodeMap-like `attributes`, array-like `childNodes`,
 *    `ownerDocument.defaultView.location`) so the DEFAULT serializer-backed
 *    fallback can be exercised end-to-end without jsdom.
 */

const RASTER_URL = "data:image/png;base64,RASTER";
const INJECTED_SNAPSHOT = "data:application/json,INJECTED";

/** Opaque element for seam-injection tests (never serialized). */
function anyEl(): Element {
  return {} as unknown as Element;
}

// --- Serializer-shaped element double (for the default-fallback test) --------

function attrMap(attrs: Record<string, string>) {
  const items = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  return { length: items.length, item: (i: number) => items[i] ?? null };
}

interface SnapNode {
  nodeType: number;
  tagName?: string;
  nodeValue?: string;
  attributes?: { length: number; item: (i: number) => unknown };
  childNodes?: SnapNode[];
  ownerDocument?: unknown;
}

function snapText(text: string): SnapNode {
  return { nodeType: 3, nodeValue: text };
}

function snapEl(
  tag: string,
  attrs: Record<string, string> = {},
  children: SnapNode[] = [],
): SnapNode {
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attributes: attrMap(attrs),
    childNodes: children,
  };
}

/** A real-shaped element subtree the serializer can walk, with an owner doc. */
function serializableEl(): Element {
  const root = snapEl("div", { id: "card", class: "promo" }, [
    snapEl("button", { "data-testid": "cta" }, [snapText("Buy now")]),
  ]);
  root.ownerDocument = {
    defaultView: {
      location: { href: "https://app.test/page?x=1", origin: "https://app.test" },
    },
  };
  return root as unknown as Element;
}

describe("captureScreenshot — element raster (preferred)", () => {
  it("returns the rasterizer's data URL and does NOT fall back when raster wins", async () => {
    const rasterize = vi.fn(async () => RASTER_URL);
    const snapshot = vi.fn(() => INJECTED_SNAPSHOT);

    const out = await captureScreenshot(anyEl(), { rasterize, snapshot });

    expect(out).toBe(RASTER_URL);
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(snapshot).not.toHaveBeenCalled();
  });
});

describe("captureScreenshot — snapshot fallback", () => {
  it("falls back to the element snapshot when no rasterizer is wired", async () => {
    const snapshot = vi.fn(() => INJECTED_SNAPSHOT);

    const out = await captureScreenshot(anyEl(), { snapshot });

    expect(out).toBe(INJECTED_SNAPSHOT);
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it("falls back to the element snapshot when the rasterizer THROWS (never throws)", async () => {
    const rasterize = vi.fn(async () => {
      throw new Error("canvas tainted by cross-origin image");
    });
    const snapshot = vi.fn(() => INJECTED_SNAPSHOT);

    let out: string | null = null;
    await expect(
      (async () => {
        out = await captureScreenshot(anyEl(), { rasterize, snapshot });
      })(),
    ).resolves.toBeUndefined();

    expect(out).toBe(INJECTED_SNAPSHOT);
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it("falls back when the rasterizer returns null", async () => {
    const rasterize = vi.fn(async () => null);
    const snapshot = vi.fn(() => INJECTED_SNAPSHOT);

    expect(await captureScreenshot(anyEl(), { rasterize, snapshot })).toBe(
      INJECTED_SNAPSHOT,
    );
  });
});

describe("captureScreenshot — both unavailable", () => {
  it("returns null when there is no rasterizer and the snapshot returns null", async () => {
    expect(await captureScreenshot(anyEl(), { snapshot: () => null })).toBeNull();
  });

  it("returns null (never throws) when BOTH raster and snapshot throw", async () => {
    const rasterize = vi.fn(async () => {
      throw new Error("raster boom");
    });
    const snapshot = vi.fn(() => {
      throw new Error("snapshot boom");
    });

    let out: string | null = "sentinel";
    await expect(
      (async () => {
        out = await captureScreenshot(anyEl(), { rasterize, snapshot });
      })(),
    ).resolves.toBeUndefined();

    expect(out).toBeNull();
  });
});

describe("captureScreenshot — default element-subtree snapshot (no injection)", () => {
  it("serializes JUST the element subtree into a data:application/json artifact", async () => {
    const out = await captureScreenshot(serializableEl(), {});

    expect(out).not.toBeNull();
    expect(out!.startsWith(BEFORE_ARTIFACT_SNAPSHOT_PREFIX)).toBe(true);

    const payload = JSON.parse(
      decodeURIComponent(out!.slice(BEFORE_ARTIFACT_SNAPSHOT_PREFIX.length)),
    );

    // Element is the root of the snapshot (element-scoped, not the whole document).
    expect(payload.root.tag).toBe("div");
    expect(payload.root.attributes.id).toBe("card");
    expect(payload.root.children[0].tag).toBe("button");
    // Element-scoped → no document-wide stylesheets captured.
    expect(payload.stylesheets).toEqual([]);
    // URL/provenance derived from the element's owner document.
    expect(payload.url).toBe("https://app.test/page?x=1");
  });

  it("returns null (never throws) when serialization fails on a malformed element", async () => {
    const bad = {
      nodeType: 1,
      tagName: "div",
      childNodes: [],
      get attributes(): never {
        throw new Error("attributes access boom");
      },
    } as unknown as Element;

    let out: string | null = "sentinel";
    await expect(
      (async () => {
        out = await captureScreenshot(bad, {});
      })(),
    ).resolves.toBeUndefined();

    expect(out).toBeNull();
  });
});

describe("encodeSnapshotArtifact", () => {
  it("round-trips a payload through the data URL (UTF-8 safe)", () => {
    const payload = { version: 1, title: "café ☕", root: { nodeId: 1 } };
    const url = encodeSnapshotArtifact(payload as never);

    expect(url.startsWith(BEFORE_ARTIFACT_SNAPSHOT_PREFIX)).toBe(true);
    const back = JSON.parse(
      decodeURIComponent(url.slice(BEFORE_ARTIFACT_SNAPSHOT_PREFIX.length)),
    );
    expect(back.title).toBe("café ☕");
  });
});

describe("attachBeforeArtifact (submit-path backstop)", () => {
  it("attaches a before-artifact to a context that lacks a screenshot", async () => {
    const ctx: { screenshot?: string } = {};

    await attachBeforeArtifact(ctx, anyEl(), { snapshot: () => INJECTED_SNAPSHOT });

    expect(ctx.screenshot).toBe(INJECTED_SNAPSHOT);
  });

  it("keeps an existing screenshot (capturer already rastered) and does NOT recapture", async () => {
    const snapshot = vi.fn(() => INJECTED_SNAPSHOT);
    const ctx = { screenshot: RASTER_URL };

    await attachBeforeArtifact(ctx, anyEl(), { snapshot });

    expect(ctx.screenshot).toBe(RASTER_URL);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("is a no-op for a null element (area / text selections)", async () => {
    const snapshot = vi.fn(() => INJECTED_SNAPSHOT);
    const ctx: { screenshot?: string } = {};

    await attachBeforeArtifact(ctx, null, { snapshot });

    expect(ctx.screenshot).toBeUndefined();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("NEVER throws and still returns the context when capture fails (submit must complete)", async () => {
    const ctx: { screenshot?: string } = {};
    const rasterize = async () => {
      throw new Error("raster boom");
    };
    const snapshot = () => {
      throw new Error("snapshot boom");
    };

    let returned: { screenshot?: string } | undefined;
    await expect(
      (async () => {
        returned = await attachBeforeArtifact(ctx, anyEl(), { rasterize, snapshot });
      })(),
    ).resolves.toBeUndefined();

    // The context is returned intact (so the submit proceeds) just without an
    // artifact — a raster/snapshot failure must never block submission.
    expect(returned).toBe(ctx);
    expect(ctx.screenshot).toBeUndefined();
  });
});
