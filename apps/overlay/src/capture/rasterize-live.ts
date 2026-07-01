/**
 * U6 (real-env wiring) — a live-DOM rasterizer backed by `modern-screenshot`.
 *
 * `captureScreenshot` (screenshot.ts) takes an injectable `rasterize(target)`;
 * this provides it for a real browser. modern-screenshot clones the LIVE target,
 * inlines its computed styles, draws it through an SVG `<foreignObject>` onto a
 * canvas, and reads back a PNG data URL — capturing the element AS RENDERED, i.e.
 * the MODIFIED state at submit for a visual edit (R15/R17). The overlay wires this
 * in at boot; the low-level serializer is INJECTED here so the adapter's contract
 * (fallback, sanitization) is unit-tested with a fake and the real library stays
 * a boot-time detail.
 *
 * Security (G1): SVG/XML serialization reflects element ATTRIBUTES, not live input
 * `.value` properties, so typed field content is not captured; we additionally
 * DROP password inputs via `filter`. (Guest rasters are withheld from the agent
 * entirely by the U16 delivery gate — this is defense-in-depth.)
 *
 * VERIFY IN REAL ENV: rasterization needs a real browser (layout + canvas) and
 * cannot run under jsdom/node. On ANY failure (cross-origin canvas taint, missing
 * canvas, web-font quirks) it resolves `null`, so `screenshot.ts` falls back to
 * the DOM snapshot — a capture failure NEVER blocks submit.
 */

/** Options we pass to the serializer (a subset of modern-screenshot's Options). */
export interface RasterizeSerializerOptions {
  /** Return false to EXCLUDE a node from the capture. */
  filter?: (node: Node) => boolean;
  backgroundColor?: string;
}

/** Low-level DOM→PNG serializer (modern-screenshot's `domToPng` satisfies this). */
export type DomToPng = (
  node: Element,
  options?: RasterizeSerializerOptions,
) => Promise<string>;

/** `<input type=password>` is dropped from the capture (defense-in-depth). */
function isSensitiveNode(node: Node): boolean {
  const el = node as {
    tagName?: string;
    getAttribute?: (name: string) => string | null;
  };
  if ((el.tagName ?? "").toUpperCase() !== "INPUT") return false;
  return (el.getAttribute?.("type") ?? "").toLowerCase() === "password";
}

/**
 * Build the injectable `rasterize` fn for {@link captureScreenshot}: draw the
 * target to a PNG via `serialize`, returning the data URL or `null` on ANY
 * failure (→ DOM-snapshot fallback). Never throws.
 */
export function createLiveRasterizer(
  serialize: DomToPng,
): (target: Element) => Promise<string | null> {
  return async (target: Element): Promise<string | null> => {
    try {
      const dataUrl = await serialize(target, {
        filter: (node) => !isSensitiveNode(node),
        backgroundColor: "#ffffff",
      });
      return typeof dataUrl === "string" && dataUrl.startsWith("data:image/")
        ? dataUrl
        : null;
    } catch {
      return null;
    }
  };
}
