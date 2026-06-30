import type { CapturedContext, ReactContext } from "@supercomment/shared";

import type { ContextCapturer, SelectionTarget } from "../core/types.js";
import { captureGenericContext } from "./generic.js";
import { captureReactContext } from "./react.js";
import { captureSourceStamp, mergeSourceStamp } from "./source.js";
import { captureScreenshot, type ScreenshotOptions } from "./screenshot.js";
import { installConsoleErrorBuffer } from "./console-buffer.js";
import { captureA11yTree } from "./a11y.js";
import { captureEnvironment } from "./environment.js";
import { captureAppState } from "./app-state.js";
import { captureNetworkRequests } from "./network.js";
import { captureProvenance } from "./provenance.js";
import {
  installInteractionBuffer,
  getRecentInteractions,
} from "./interaction-buffer.js";
import { deviceSurfaceForWidth } from "@supercomment/shared";

export { captureGenericContext } from "./generic.js";
export { captureAnchors, buildDomPath } from "./anchors.js";
export {
  captureReactContext,
  findFiber,
  buildComponentPath,
  displayNameOf,
  findDebugSource,
} from "./react.js";
export {
  captureSourceStamp,
  parseSourceStamp,
  mergeSourceStamp,
  SOURCE_STAMP_ATTR,
  type SourceStamp,
} from "./source.js";
export { captureScreenshot } from "./screenshot.js";
export {
  installConsoleErrorBuffer,
  getRecentConsoleErrors,
  resetConsoleErrorBuffer,
} from "./console-buffer.js";
export { captureA11yTree, describeNode } from "./a11y.js";
export { captureEnvironment } from "./environment.js";
export { captureAppState } from "./app-state.js";
export { captureNetworkRequests } from "./network.js";
export { captureProvenance } from "./provenance.js";
export {
  installInteractionBuffer,
  getRecentInteractions,
  resetInteractionBuffer,
  recordInteraction,
  compactSelector,
  describeInteractionTarget,
  isWithinOverlay,
} from "./interaction-buffer.js";

/** Options for {@link createContextCapturer}. */
export interface CreateCapturerOptions {
  /** Forwarded to the screenshot module (e.g. an injected rasterizer). */
  screenshot?: ScreenshotOptions;
  /**
   * Install the console-error buffer when the capturer is created. Defaults to
   * true so the buffer starts collecting as early as possible.
   */
  installConsoleBuffer?: boolean;
  /**
   * Install the passive interaction-trail buffer when the capturer is created.
   * Defaults to true so breadcrumbs accumulate from boot. Listeners are passive
   * (cannot affect app behaviour); set false to opt out entirely.
   */
  installInteractionBuffer?: boolean;
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
    if (options.installInteractionBuffer !== false) {
      installInteractionBuffer();
    }
  }

  async capture(target: SelectionTarget): Promise<CapturedContext> {
    const generic = captureGenericContext(target);

    const context: CapturedContext = { ...generic };

    // React tier degrades gracefully: null on non-React pages / area selections.
    const el = primaryElementOf(target);
    if (el) {
      let react: ReactContext | null = null;
      try {
        react = captureReactContext(el);
      } catch {
        // Non-React app or unreadable fiber -> stay generic-only.
      }
      // Overlay the build-time `data-sc-source` stamp (the authoritative
      // file:line source on React 19, read via el.closest()). Absent the
      // attribute this is a no-op and the fiber component-path capture stands.
      react = mergeSourceStamp(react, captureSourceStamp(el));
      if (react) {
        context.react = react;
      }
    }

    // Screenshot is best-effort and never blocks.
    if (el) {
      const screenshot = await captureScreenshot(el, this.screenshotOptions);
      if (screenshot) {
        context.screenshot = screenshot;
      }
    }

    // Additive runtime context — all read-only and best-effort. Each helper is
    // internally guarded, but the whole block is also wrapped: if anything
    // unexpected throws, the comment still captures with its core context
    // (selector, screenshot, react, console) intact — enrichment is never
    // allowed to break commenting. Page/runtime fields work even without a
    // target element (area/text selections); the a11y chain needs an element.
    try {
      const doc =
        el?.ownerDocument ??
        (typeof document !== "undefined" ? document : undefined);
      const view =
        doc?.defaultView ??
        (typeof window !== "undefined" ? window : undefined);

      const environment = captureEnvironment(view ?? undefined);
      if (environment) {
        context.environment = environment;
      }
      const appState = captureAppState(view ?? undefined);
      if (appState) {
        context.appState = appState;
      }
      const networkRequests = captureNetworkRequests(view ?? undefined);
      if (networkRequests) {
        context.networkRequests = networkRequests;
      }
      const interactionTrail = getRecentInteractions();
      if (interactionTrail.length > 0) {
        context.interactionTrail = interactionTrail;
      }
      const provenance = captureProvenance(view ?? undefined, doc ?? undefined);
      if (provenance.deployUrl) {
        context.deployUrl = provenance.deployUrl;
      }
      if (provenance.commit) {
        context.commit = provenance.commit;
      }
      const a11yTree = captureA11yTree(el);
      if (a11yTree) {
        context.a11yTree = a11yTree;
      }
      // Surface tag — auto-derived from the captured viewport width (the
      // device-mode toolbar will set this explicitly in Phase 1).
      const surface = deviceSurfaceForWidth(context.viewport?.width);
      if (surface) {
        context.surface = surface;
      }
    } catch {
      // Enrichment is strictly optional — never let it break a comment.
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
