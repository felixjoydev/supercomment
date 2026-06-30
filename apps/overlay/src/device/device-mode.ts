import type { DevicePreset } from "@supercomment/shared";

/**
 * Responsive device-mode lifecycle.
 *
 * Entering device mode loads the CURRENT page inside a same-origin iframe sized
 * to a device, so CSS media queries genuinely fire (the iframe gets its own
 * viewport). A second overlay controller is then mounted against the iframe's
 * document — the reviewer comments on the real mobile/tablet layout, and the
 * existing capture auto-tags those comments with the iframe's viewport/surface.
 *
 * Safety: this is fully opt-in. The iframe URL carries {@link DEVICE_CHILD_PARAM}
 * so the iframe's OWN overlay bundle does not auto-mount (no recursion). Exit
 * removes the iframe, which lets the browser reclaim the child controller and
 * all its listeners. If the page can't be framed (X-Frame-Options) or resolves
 * cross-origin, entering fails gracefully back to normal mode.
 */

/**
 * Query-param marker the parent puts on the device-iframe URL. The overlay boot
 * checks for it and skips auto-mount inside the iframe.
 */
export const DEVICE_CHILD_PARAM = "__sc_device_child";

/** True when the current location is the device-mode child iframe. */
export function isDeviceChild(search: string | undefined | null): boolean {
  if (!search) {
    return false;
  }
  try {
    return new URLSearchParams(search).has(DEVICE_CHILD_PARAM);
  } catch {
    return false;
  }
}

interface LocationLike {
  origin?: string;
  pathname?: string;
  search?: string;
}

/**
 * Build the same-origin URL to load inside the device iframe: the current page
 * plus the suppress marker. Existing query params are preserved; the hash is
 * dropped (the review token has already been consumed at boot). Returns null
 * when the origin is unusable (e.g. an opaque "null" origin).
 */
export function buildChildUrl(loc: LocationLike | undefined): string | null {
  if (!loc?.origin || loc.origin === "null") {
    return null;
  }
  try {
    const url = new URL(`${loc.origin}${loc.pathname ?? "/"}`);
    const params = new URLSearchParams(loc.search ?? "");
    params.set(DEVICE_CHILD_PARAM, "1");
    url.search = params.toString();
    return url.toString();
  } catch {
    return null;
  }
}

/** A mounted child overlay; the only thing device mode needs from it. */
export interface ChildController {
  destroy(): void;
}

export interface DeviceModeDeps {
  /** The parent document (where the backdrop/iframe chrome mounts). */
  doc: Document;
  /** The parent shell layer; direct children get pointer-events:auto. */
  container: HTMLElement;
  /** Mount a child overlay controller bound to the iframe document for a preset. */
  mountChild: (doc: Document, preset: DevicePreset) => ChildController;
  /** Surfaced when entering fails (cross-origin / frame-busted / no origin). */
  onError?: (message: string) => void;
  /** Notified when the active preset changes (incl. exit → null). */
  onChange?: (preset: DevicePreset | null) => void;
}

export class DeviceMode {
  private backdrop: HTMLElement | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private child: ChildController | null = null;
  private active: DevicePreset | null = null;

  constructor(private readonly deps: DeviceModeDeps) {}

  isActive(): boolean {
    return this.active !== null;
  }

  current(): DevicePreset | null {
    return this.active;
  }

  /** Enter (or switch) device mode for a preset. Tears down any prior frame. */
  enter(preset: DevicePreset): void {
    this.teardownFrame();

    const view = this.deps.doc.defaultView;
    const url = buildChildUrl(view?.location ?? undefined);
    if (!url) {
      this.fail("Device preview isn't available on this page.");
      return;
    }

    const backdrop = this.deps.doc.createElement("div");
    backdrop.className = "sc-device-backdrop";

    const frame = this.deps.doc.createElement("div");
    frame.className = "sc-device-frame";
    frame.style.width = `${preset.width}px`;
    frame.style.height = `${preset.height}px`;

    const size = this.deps.doc.createElement("div");
    size.className = "sc-device-size";
    size.textContent = `${preset.label} · ${preset.width}×${preset.height}`;

    const iframe = this.deps.doc.createElement("iframe");
    iframe.className = "sc-device-iframe";
    iframe.setAttribute("title", `${preset.label} preview`);
    iframe.addEventListener("load", () => this.onIframeLoad());
    iframe.src = url;

    frame.append(size, iframe);
    backdrop.appendChild(frame);
    this.deps.container.appendChild(backdrop);

    this.backdrop = backdrop;
    this.iframe = iframe;
    this.active = preset;
    this.deps.onChange?.(preset);
  }

  /** Exit device mode and restore the normal full-page view. */
  exit(): void {
    const wasActive = this.active !== null;
    this.teardownFrame();
    this.active = null;
    if (wasActive) {
      this.deps.onChange?.(null);
    }
  }

  // VERIFY IN REAL ENV: iframe load + same-origin contentDocument access is
  // browser behaviour; unit tests cover the pure URL/lifecycle logic.
  private onIframeLoad(): void {
    const iframe = this.iframe;
    if (!iframe) {
      return;
    }
    let childDoc: Document | null = null;
    try {
      childDoc = iframe.contentDocument;
    } catch {
      childDoc = null; // cross-origin — not accessible
    }
    if (!childDoc) {
      this.fail("This site can't be opened in device preview (framing blocked).");
      return;
    }
    // Re-mount on (re)load; a fresh child binds to the new document.
    this.destroyChild();
    const preset = this.active;
    if (!preset) {
      return;
    }
    try {
      this.child = this.deps.mountChild(childDoc, preset);
    } catch {
      this.fail("Couldn't start device preview.");
    }
  }

  private fail(message: string): void {
    this.teardownFrame();
    this.active = null;
    this.deps.onError?.(message);
    this.deps.onChange?.(null);
  }

  private destroyChild(): void {
    try {
      this.child?.destroy();
    } catch {
      // best-effort
    }
    this.child = null;
  }

  private teardownFrame(): void {
    this.destroyChild();
    if (this.backdrop) {
      this.backdrop.remove(); // removes the iframe → child realm is reclaimed
    }
    this.backdrop = null;
    this.iframe = null;
  }
}
