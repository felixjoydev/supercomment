/**
 * U6 (real-env wiring) — a live-DOM rasterizer backed by `modern-screenshot`.
 *
 * `captureScreenshot` (screenshot.ts) takes an injectable `rasterize(target)`;
 * this provides it for a real browser. modern-screenshot clones the LIVE target,
 * inlines its computed styles, draws it through an SVG `<foreignObject>` onto a
 * canvas, and reads back a PNG data URL — capturing the element AS RENDERED, i.e.
 * the MODIFIED state at submit for a visual edit (R15/R17). The low-level
 * serializer is INJECTED here so the adapter's contract (fallback, sanitization)
 * is unit-tested with a fake and the real library stays a boot-time detail.
 *
 * Security (G1): modern-screenshot copies a live input's `.value` into a `value`
 * attribute on its clone, so typed field content WOULD otherwise be rasterized
 * into the screenshot (an un-redactable channel to the agent). We scrub it on the
 * library's per-cloned-node hook using the SAME {@link blankSensitiveField} the
 * detached-clone path uses — one source of truth for the defense.
 *
 * VERIFY IN REAL ENV: rasterization needs a real browser (layout + canvas) and
 * cannot run under jsdom/node. On ANY failure (cross-origin canvas taint, missing
 * canvas, web-font quirks) it resolves `null`, so `screenshot.ts` falls back to
 * the DOM snapshot — a capture failure NEVER blocks submit.
 */
import { blankSensitiveField } from "./rasterize.js";

/** Options we pass to the serializer (a subset of modern-screenshot's Options). */
export interface RasterizeSerializerOptions {
  /** Invoked on each cloned node before serialization — we blank sensitive fields here. */
  onCloneEachNode?: (node: Node) => void;
  backgroundColor?: string;
}

/** Low-level DOM→PNG serializer (modern-screenshot's `domToPng` satisfies this). */
export type DomToPng = (
  node: Element,
  options?: RasterizeSerializerOptions,
) => Promise<string>;

/**
 * Build the injectable `rasterize` fn for {@link captureScreenshot}: draw the
 * target to a PNG via `serialize`, blanking sensitive fields on every cloned node
 * (G1), and returning the data URL or `null` on ANY failure (→ DOM-snapshot
 * fallback). Never throws.
 */
export function createLiveRasterizer(
  serialize: DomToPng,
): (target: Element) => Promise<string | null> {
  return async (target: Element): Promise<string | null> => {
    try {
      const dataUrl = await serialize(target, {
        onCloneEachNode: blankSensitiveField,
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
