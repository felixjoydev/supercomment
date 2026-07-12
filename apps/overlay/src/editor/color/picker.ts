/**
 * U10 — the color picker popover.
 *
 * A real, alpha-correct color editor that replaces the native `<input type=color>`
 * swatch (which cannot express alpha): a saturation/value area, hue and alpha
 * sliders, hex / hex8 / rgba text entry, the page palette, session recents, and a
 * feature-detected eyedropper. Editing writes the COLOR PROPERTY'S OWN alpha
 * (`rgba(...)`), never element opacity (which moves to its own control). Every
 * surface is keyboard-operable and the popover returns focus to its trigger.
 *
 * Color math goes through the shared U1 pipeline (the injected {@link ColorProbe}
 * canonicalizes any input syntax); the HSV conversions here are pure and unit-
 * tested. All DOM access is via injected seams so the state machine is testable
 * under the node doubles; value-truth is proven on the U17 real-page matrix.
 */
import type { EscapeLayer } from "../escape-stack.js";
import {
  rgbaToCss,
  rgbaToHex8,
  type ColorProbe,
  type Rgba,
} from "./normalize.js";

/** HSV: hue 0-360, saturation + value 0-1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** RGB (bytes) → HSV. Hue is 0 for grayscale (caller may preserve a prior hue). */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

/** HSV → RGB (bytes). */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: clampByte((r + m) * 255), g: clampByte((g + m) * 255), b: clampByte((b + m) * 255) };
}

export interface ColorPickerOptions {
  doc: Document;
  container: HTMLElement;
  create?: (tag: string, className?: string) => HTMLElement;
  probe: ColorProbe;
  /** The element's current CSS color value (the initial picker state). */
  initial: string;
  /** The page palette as hex8 swatches (U10a). */
  palette: string[];
  /** Session recents as hex8, most-recent first. */
  recents: string[];
  /** Fires on every adjustment with the CSS value to write + any matched token (U11). */
  onChange(css: string, valueToken?: string | null): void;
  /** Resolve a css value to a page design-token name, or null (U11). */
  matchToken?: (css: string) => string | null;
  /** The popover closed (commit / Escape / outside) — return focus + drop ref. */
  onClose(): void;
  /** A color was committed (hex8), for the session recents. */
  onPicked?(hex8: string): void;
  /** Register the picker's Escape layer with the controller's stack (U2). */
  registerEscape?: (layer: EscapeLayer) => () => void;
  /** Feature-detect the eyedropper (default: `window.EyeDropper`). */
  hasEyeDropper?: () => boolean;
  /** Launch the eyedropper; resolves an sRGB hex or null (default: window.EyeDropper). */
  openEyeDropper?: () => Promise<string | null>;
}

export class ColorPicker {
  private readonly doc: Document;
  private readonly create: (tag: string, className?: string) => HTMLElement;
  private readonly opts: ColorPickerOptions;

  private root: HTMLElement | null = null;
  private svEl!: HTMLElement;
  private svThumb!: HTMLElement;
  private hueEl!: HTMLInputElement;
  private alphaEl!: HTMLInputElement;
  private hexEl!: HTMLInputElement;

  /** State: hue 0-360, sat/val 0-1, alpha 0-1. Hue is kept across grayscale. */
  private h = 0;
  private s = 0;
  private v = 0;
  private a = 1;

  private unregisterEscape: (() => void) | null = null;
  private outsideHandler: ((e: unknown) => void) | null = null;
  private closed = false;
  /** Whether the color was actually adjusted (drives the recents update on close). */
  private dirty = false;

  constructor(opts: ColorPickerOptions) {
    this.opts = opts;
    this.doc = opts.doc;
    this.create =
      opts.create ??
      ((tag, cls) => {
        const el = this.doc.createElement(tag);
        if (cls) el.className = cls;
        return el;
      });
    this.setFromCss(opts.initial, false);
  }

  open(): void {
    this.build();
    this.unregisterEscape = this.opts.registerEscape?.({
      priority: 30, // ESCAPE_PRIORITY.popover
      isActive: () => !this.closed,
      close: () => this.close(),
    }) ?? null;
    this.syncControls();
    this.svEl.focus?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Record the committed color into the session recents (only if it changed).
    if (this.dirty) this.opts.onPicked?.(rgbaToHex8(this.rgba()));
    this.unregisterEscape?.();
    if (this.outsideHandler) {
      (this.doc as unknown as {
        removeEventListener?: (t: string, cb: (e: unknown) => void, o?: unknown) => void;
      }).removeEventListener?.("pointerdown", this.outsideHandler, true);
    }
    this.root?.remove();
    this.root = null;
    this.opts.onClose();
  }

  // --- State ----------------------------------------------------------------

  private rgba(): Rgba {
    const { r, g, b } = hsvToRgb(this.h, this.s, this.v);
    return { r, g, b, a: this.a };
  }

  /** Parse a CSS value into HSV+alpha; keep the prior hue when the input is gray. */
  private setFromCss(css: string, emit: boolean): void {
    const c = this.opts.probe.toRgba(css);
    if (c) {
      const hsv = rgbToHsv(c.r, c.g, c.b);
      if (hsv.s > 0) this.h = hsv.h; // preserve hue at s=0 (gray) to avoid jumps
      this.s = hsv.s;
      this.v = hsv.v;
      this.a = clamp01(c.a);
    }
    if (emit) this.emit();
  }

  private emit(): void {
    this.dirty = true;
    const css = rgbaToCss(this.rgba());
    const token = this.opts.matchToken?.(css) ?? null;
    this.opts.onChange(css, token);
    this.renderTokenChip(token);
    this.syncControls();
  }

  /** Show / clear the "matches --token" chip when a pick lands on a design token. */
  private renderTokenChip(token: string | null): void {
    if (!this.root) return;
    const existing = this.root.querySelector?.(".sc-ep-token-chip") as HTMLElement | null;
    if (!token) {
      existing?.remove?.();
      return;
    }
    const chip = existing ?? this.create("div", "sc-ep-token-chip");
    chip.setAttribute("role", "status");
    chip.textContent = `Matches ${token}`;
    if (!existing) this.root.appendChild(chip);
  }

  // --- DOM ------------------------------------------------------------------

  private build(): void {
    const root = this.create("div", "sc-ep-colorpop");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Choose a color");

    // Saturation/value area — a focusable 2D slider (arrow keys step s/v).
    const sv = this.create("div", "sc-ep-sv");
    sv.setAttribute("role", "slider");
    sv.setAttribute("tabindex", "0");
    sv.setAttribute("aria-label", "Saturation and brightness");
    const thumb = this.create("div", "sc-ep-sv-thumb");
    sv.appendChild(thumb);
    this.svEl = sv;
    this.svThumb = thumb;
    this.on(sv, "keydown", (e) => this.onSvKey(e));

    // Hue + alpha sliders — native ranges (built-in keyboard stepping).
    const hue = this.create("input", "sc-ep-hue") as HTMLInputElement;
    hue.type = "range";
    hue.min = "0";
    hue.max = "360";
    hue.setAttribute("aria-label", "Hue");
    this.hueEl = hue;
    this.on(hue, "input", () => {
      this.h = Number(hue.value) || 0;
      this.emit();
    });

    const alpha = this.create("input", "sc-ep-alpha") as HTMLInputElement;
    alpha.type = "range";
    alpha.min = "0";
    alpha.max = "100";
    alpha.setAttribute("aria-label", "Opacity of this color");
    this.alphaEl = alpha;
    this.on(alpha, "input", () => {
      this.a = clamp01((Number(alpha.value) || 0) / 100);
      this.emit();
    });

    // Hex / rgba text entry.
    const hexRow = this.create("div", "sc-ep-colorhex-row");
    const hex = this.create("input", "sc-ep-colorhex") as HTMLInputElement;
    hex.type = "text";
    hex.setAttribute("aria-label", "Hex or rgba color");
    hex.placeholder = "#000000";
    this.hexEl = hex;
    const commitHex = (): void => {
      const parsed = this.opts.probe.toRgba(hex.value.trim());
      if (parsed) this.setFromCss(hex.value.trim(), true);
      else this.syncControls(); // reject garbage: restore the last good value
    };
    this.on(hex, "change", commitHex);
    this.on(hex, "keydown", (e) => {
      if ((e as { key?: string }).key === "Enter") commitHex();
    });
    hexRow.appendChild(hex);

    // Eyedropper (feature-detected).
    if (this.eyeDropperAvailable()) {
      const eye = this.create("button", "sc-ep-eyedropper") as HTMLButtonElement;
      eye.type = "button";
      eye.textContent = "Pick";
      eye.title = "Pick a color from the page";
      eye.setAttribute("aria-label", "Pick a color from the page");
      this.on(eye, "click", () => void this.pickWithEyeDropper());
      hexRow.appendChild(eye);
    }

    root.append(sv, hue, alpha, hexRow);
    this.appendSwatches(root, "Page colors", this.opts.palette);
    this.appendSwatches(root, "Recent", this.opts.recents);

    this.opts.container.appendChild(root);
    this.root = root;

    this.outsideHandler = (e: unknown): void => {
      const t = (e as { target?: unknown }).target as { closest?: (s: string) => unknown } | null;
      if (t?.closest?.(".sc-ep-colorpop")) return;
      if (t?.closest?.(".sc-ep-colorbtn")) return;
      this.close();
    };
    (this.doc as unknown as {
      addEventListener?: (t: string, cb: (e: unknown) => void, o?: unknown) => void;
    }).addEventListener?.("pointerdown", this.outsideHandler, true);
  }

  private appendSwatches(root: HTMLElement, label: string, colors: string[]): void {
    if (colors.length === 0) return;
    const head = this.create("div", "sc-ep-swatch-label");
    head.textContent = label;
    const grid = this.create("div", "sc-ep-swatch-grid");
    for (const color of colors) {
      const sw = this.create("button", "sc-ep-swatch-btn") as HTMLButtonElement;
      sw.type = "button";
      sw.style.background = color;
      sw.setAttribute("aria-label", color);
      sw.title = color;
      this.on(sw, "click", () => this.setFromCss(color, true));
      grid.appendChild(sw);
    }
    root.append(head, grid);
  }

  /** Reflect the current state into the hue/alpha/hex controls + the SV thumb. */
  private syncControls(): void {
    if (!this.root) return;
    this.hueEl.value = String(Math.round(this.h));
    this.alphaEl.value = String(Math.round(this.a * 100));
    const rgba = this.rgba();
    this.hexEl.value = this.a >= 1 ? rgbaToHex8(rgba).slice(0, 7) : rgbaToHex8(rgba);
    // Thumb position (real DOM only; a no-op string under the doubles).
    this.svThumb.style.left = `${this.s * 100}%`;
    this.svThumb.style.top = `${(1 - this.v) * 100}%`;
    this.svEl.setAttribute("aria-valuetext", this.hexEl.value);
  }

  // --- Interaction ----------------------------------------------------------

  private onSvKey(e: unknown): void {
    const ke = e as { key?: string; shiftKey?: boolean; preventDefault?: () => void };
    const step = ke.shiftKey ? 0.1 : 0.02;
    let handled = true;
    switch (ke.key) {
      case "ArrowLeft":
        this.s = clamp01(this.s - step);
        break;
      case "ArrowRight":
        this.s = clamp01(this.s + step);
        break;
      case "ArrowUp":
        this.v = clamp01(this.v + step);
        break;
      case "ArrowDown":
        this.v = clamp01(this.v - step);
        break;
      case "Escape":
        ke.preventDefault?.();
        (e as { stopPropagation?: () => void }).stopPropagation?.();
        this.close();
        return;
      default:
        handled = false;
    }
    if (handled) {
      ke.preventDefault?.();
      this.emit();
    }
  }

  private eyeDropperAvailable(): boolean {
    if (this.opts.hasEyeDropper) return this.opts.hasEyeDropper();
    try {
      return typeof (this.doc.defaultView as { EyeDropper?: unknown } | null)?.EyeDropper === "function";
    } catch {
      return false;
    }
  }

  /** Launch the eyedropper and adopt the picked color, PRESERVING the current alpha. */
  private async pickWithEyeDropper(): Promise<void> {
    let hex: string | null = null;
    try {
      hex = this.opts.openEyeDropper
        ? await this.opts.openEyeDropper()
        : await this.defaultEyeDropper();
    } catch {
      hex = null;
    }
    if (this.closed || !hex) return;
    const prevAlpha = this.a;
    this.setFromCss(hex, false);
    this.a = prevAlpha; // eyedropper returns opaque sRGB — keep the swatch's alpha
    this.emit();
  }

  private async defaultEyeDropper(): Promise<string | null> {
    const view = this.doc.defaultView as {
      EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }>; };
    } | null;
    if (!view?.EyeDropper) return null;
    const res = await new view.EyeDropper().open();
    return res?.sRGBHex ?? null;
  }

  private on(target: unknown, type: string, handler: (e: unknown) => void): void {
    (target as { addEventListener?: (t: string, h: (e: unknown) => void) => void }).addEventListener?.(
      type,
      handler,
    );
  }
}
