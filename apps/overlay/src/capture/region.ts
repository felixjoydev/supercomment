/**
 * Region-scoped "before" capture (supersedes bare-element rasterization).
 *
 * WHY: rasterizing the SELECTED ELEMENT in isolation (`domToPng(el)`) fails on
 * real pages in three ways we verified against a live deploy:
 *   1. a zero-size / detached element yields nothing -> the caller fell back to a
 *      non-image DOM snapshot (the dashboard then shows a "snapshot" placeholder,
 *      never a picture);
 *   2. some leaf elements (e.g. a lone styled `<p>`) render BLANK when captured
 *      alone (the isolated foreignObject drops the text);
 *   3. area/text selections have no element at all, so nothing was ever captured.
 *
 * FIX: raster the page ONCE and crop to the target's rect. The browser lays the
 * page out normally, so the cropped region always shows real content (the same
 * leaf that rendered blank in isolation renders fully here). This is the "capture
 * just that area" behaviour for every selection mode: element, multi, area, text.
 * Selecting a full-page background simply yields a rect that spans the page, so
 * the whole page is captured — that is intended.
 *
 * Two product rules baked in:
 *   - HIDE OTHER ANNOTATIONS: the overlay host (toolbar, selection UI, and every
 *     existing comment pin) is excluded from the raster via `filter`, so no OTHER
 *     comment is marked in the shot.
 *   - MARK ONLY THIS ONE: the exact target rect is outlined onto the crop, so the
 *     shot marks the region this comment is about and nothing else.
 *
 * Security (G1) is preserved: the SAME `blankSensitiveField` hook the isolated
 * rasterizer used runs on every cloned node, so a full-page raster can never bake
 * a typed field value / password into the image.
 *
 * VERIFY IN REAL ENV: real rasterization needs a browser (layout + canvas) and
 * cannot run under jsdom. On ANY failure this resolves `null`, so the caller
 * falls back to the DOM snapshot and a capture failure NEVER blocks submit.
 */
import type { Rect } from "../core/types.js";
import { blankSensitiveField } from "./rasterize.js";
import { HOST_ELEMENT_ID } from "../shell/root.js";

/** Options we pass to the serializer (a subset of modern-screenshot's Options). */
export interface RegionSerializerOptions {
  onCloneEachNode?: (node: Node) => void;
  backgroundColor?: string;
  /** Return false to EXCLUDE a node (and its subtree) from the raster. */
  filter?: (node: Node) => boolean;
  /** Output pixel scale; we clamp it so a long page can't exceed canvas limits. */
  scale?: number;
}

/** Low-level DOM->canvas serializer (modern-screenshot's `domToCanvas` satisfies this). */
export type DomToCanvas = (
  node: Element,
  options?: RegionSerializerOptions,
) => Promise<HTMLCanvasElement>;

/** The target to capture: its viewport-space rect plus its element when it has one. */
export interface RegionInput {
  /** Viewport-space rect (element/multi/area/text all produce one). */
  rect: Rect;
  /** The primary element, when the selection has one; null for area/text. */
  element: Element | null;
}

/** 0x0 / tiny targets still yield a visible thumbnail with a little context. */
export const MIN_CROP_PX = 32;
/** A little breathing room around the target so the mark is not flush to the edge. */
export const CROP_PADDING_PX = 10;
/** Guard against the browser's max canvas dimension on very long pages. */
export const MAX_CANVAS_DIM = 8192;
/** The persimmon used for the "this exact area" mark (matches the pin colour). */
const MARK_COLOR = "#e2483d";

/**
 * Build the injectable region rasterizer for the capturer: raster the page's
 * scrolling root (excluding the overlay), crop to the target rect, outline the
 * target, and return a PNG data URL — or `null` on ANY failure. Never throws.
 */
export function createRegionRasterizer(
  serialize: DomToCanvas,
): (input: RegionInput) => Promise<string | null> {
  return async ({ rect, element }: RegionInput): Promise<string | null> => {
    try {
      const doc =
        element?.ownerDocument ??
        (typeof document !== "undefined" ? document : null);
      const view =
        doc?.defaultView ??
        (typeof window !== "undefined" ? window : null);
      if (!doc || !view) return null;

      const src = (doc.scrollingElement ?? doc.documentElement) as
        | (Element & { scrollWidth: number; scrollHeight: number; clientWidth: number })
        | null;
      if (!src) return null;

      const srcW = src.scrollWidth || src.clientWidth || 1;
      const srcH = src.scrollHeight || 1;
      const dpr = view.devicePixelRatio || 1;
      // Bound the canvas so a tall page can't blow past the browser's ~8k limit.
      const scale = Math.max(
        0.5,
        Math.min(dpr, MAX_CANVAS_DIM / srcW, MAX_CANVAS_DIM / srcH),
      );

      const canvas = await serialize(src, {
        onCloneEachNode: blankSensitiveField, // G1: never rasterize typed content
        backgroundColor: "#ffffff",
        filter: excludeOverlayHost, // hide toolbar + every existing pin
        scale,
      });
      if (!canvas || !canvas.width || !canvas.height) return null;

      // Effective scale read back from the ACTUAL canvas (robust to whatever the
      // serializer applied), used to map document px -> canvas px.
      const eff = canvas.width / (src.clientWidth || srcW);
      const scrollX = view.scrollX ?? view.pageXOffset ?? 0;
      const scrollY = view.scrollY ?? view.pageYOffset ?? 0;

      return cropAndMark(doc, canvas, rect, scrollX, scrollY, eff);
    } catch {
      return null;
    }
  };
}

/**
 * Exclude the single overlay host node (and thus all overlay UI / every existing
 * pin) from the raster. Duck-typed on `nodeType` rather than `instanceof Element`
 * so it holds across realms (iframes) and is testable without a DOM.
 */
export function excludeOverlayHost(node: Node): boolean {
  try {
    const el = node as Element;
    return !(node.nodeType === 1 && el.id === HOST_ELEMENT_ID);
  } catch {
    return true;
  }
}

/**
 * The padded, min-sized crop box for a target rect, in DOCUMENT space.
 * Pure (no DOM) so the geometry is unit-testable without a browser.
 */
export function cropBox(
  rect: Rect,
  scrollX: number,
  scrollY: number,
): { x: number; y: number; width: number; height: number } {
  let x = rect.x + scrollX - CROP_PADDING_PX;
  let y = rect.y + scrollY - CROP_PADDING_PX;
  let width = rect.width + CROP_PADDING_PX * 2;
  let height = rect.height + CROP_PADDING_PX * 2;
  if (width < MIN_CROP_PX) {
    x -= (MIN_CROP_PX - width) / 2;
    width = MIN_CROP_PX;
  }
  if (height < MIN_CROP_PX) {
    y -= (MIN_CROP_PX - height) / 2;
    height = MIN_CROP_PX;
  }
  return { x: Math.max(0, x), y: Math.max(0, y), width, height };
}

/** Crop the page canvas to the target region and outline the exact target. */
function cropAndMark(
  doc: Document,
  canvas: HTMLCanvasElement,
  rect: Rect,
  scrollX: number,
  scrollY: number,
  eff: number,
): string | null {
  const box = cropBox(rect, scrollX, scrollY);
  const sx = Math.max(0, Math.round(box.x * eff));
  const sy = Math.max(0, Math.round(box.y * eff));
  const sw = Math.max(1, Math.min(Math.round(box.width * eff), canvas.width - sx));
  const sh = Math.max(1, Math.min(Math.round(box.height * eff), canvas.height - sy));

  const out = doc.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const cx = out.getContext("2d");
  if (!cx) return null;
  cx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  // Mark ONLY this target: its rect relative to the crop origin, in canvas px.
  const mx = (rect.x + scrollX) * eff - sx;
  const my = (rect.y + scrollY) * eff - sy;
  const mw = rect.width * eff;
  const mh = rect.height * eff;
  cx.strokeStyle = MARK_COLOR;
  cx.lineWidth = Math.max(2, Math.round(2 * eff));
  if (mw < 8 || mh < 8) {
    // A near-zero-size target: mark the spot with a dot rather than a hairline.
    cx.fillStyle = MARK_COLOR;
    cx.beginPath();
    cx.arc(mx + mw / 2, my + mh / 2, Math.max(5, 5 * eff), 0, Math.PI * 2);
    cx.fill();
  } else {
    cx.strokeRect(mx, my, mw, mh);
  }

  const url = out.toDataURL("image/png");
  return typeof url === "string" && url.startsWith("data:image/") ? url : null;
}
