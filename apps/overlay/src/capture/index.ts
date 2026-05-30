import type { CapturedContext } from "@supercomment/shared";

import type { ContextCapturer, SelectionTarget } from "../core/types.js";
import { captureGenericContext } from "./generic.js";
import { captureReactContext } from "./react.js";
import { captureScreenshot, type ScreenshotOptions } from "./screenshot.js";
import { installConsoleErrorBuffer } from "./console-buffer.js";

export { captureGenericContext } from "./generic.js";
export { captureAnchors, buildDomPath } from "./anchors.js";
export {
  captureReactContext,
  findFiber,
  buildComponentPath,
  displayNameOf,
  findDebugSource,
} from "./react.js";
export { captureScreenshot } from "./screenshot.js";
export {
  installConsoleErrorBuffer,
  getRecentConsoleErrors,
  resetConsoleErrorBuffer,
} from "./console-buffer.js";

/** Options for {@link createContextCapturer}. */
export interface CreateCapturerOptions {
  /** Forwarded to the screenshot module (e.g. an injected rasterizer). */
  screenshot?: ScreenshotOptions;
  /**
   * Install the console-error buffer when the capturer is created. Defaults to
   * true so the buffer starts collecting as early as possible.
   */
  installConsoleBuffer?: boolean;
}

/**
 * The real U7 context capturer: generic tier for any framework, plus best-effort
 * React component path / source and a best-effort screenshot. Implements the
 * `ContextCapturer` seam the overlay's `OverlayConfig.capturer` expects,
 * replacing the U6 `StubContextCapturer`.
 *
 * Composing here keeps each capture concern (generic / anchors / react /
 * screenshot / console) in its own module while presenting the single
 * `capture(target) => Promise<CapturedContext>` interface.
 */
export class RealContextCapturer implements ContextCapturer {
  private readonly screenshotOptions: ScreenshotOptions;

  constructor(options: CreateCapturerOptions = {}) {
    this.screenshotOptions = options.screenshot ?? {};
    if (options.installConsoleBuffer !== false) {
      installConsoleErrorBuffer();
    }
  }

  async capture(target: SelectionTarget): Promise<CapturedContext> {
    const generic = captureGenericContext(target);

    const context: CapturedContext = { ...generic };

    // React tier degrades gracefully: null on non-React pages / area selections.
    const el = primaryElementOf(target);
    if (el) {
      try {
        const react = captureReactContext(el);
        if (react) {
          context.react = react;
        }
      } catch {
        // Non-React app or unreadable fiber -> stay generic-only.
      }
    }

    // Screenshot is best-effort and never blocks.
    if (el) {
      const screenshot = await captureScreenshot(el, this.screenshotOptions);
      if (screenshot) {
        context.screenshot = screenshot;
      }
    }

    return context;
  }
}

/** Functional factory mirroring {@link RealContextCapturer}. */
export function createContextCapturer(
  options: CreateCapturerOptions = {},
): ContextCapturer {
  return new RealContextCapturer(options);
}

/** The element a React/screenshot capture should target, if any. */
function primaryElementOf(target: SelectionTarget): Element | null {
  switch (target.kind) {
    case "element":
      return target.element;
    case "multi":
      return target.elements[0] ?? null;
    case "text":
    case "area":
      return null;
  }
}
