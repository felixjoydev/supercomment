/**
 * U1 — one colour-normalization pipeline.
 *
 * In 2026 `getComputedStyle` returns modern function forms (oklch, lab, color())
 * unchanged, and hand-rolled `rgb()/#hex` parsing (the old `rgbToHex`) silently
 * shows black for anything else and drops alpha (a transparent background read as
 * `#000000`). The fix is to resolve EVERY colour through a single seam: a 1x1
 * canvas `fillStyle` + `getImageData` readback that the browser resolves to sRGB
 * bytes + straight alpha, whatever the input syntax.
 *
 * The seam is an injectable {@link ColorProbe} so the pure conversions can be
 * unit-tested under the node doubles (a canvas is not available there); the real
 * canvas readback's value-truth is proven on the U17 real-page matrix. Reads,
 * the palette (U10), and token matching (U11) all share this one pipeline so an
 * `oklch(...)` and its `rgb(...)` equivalent compare equal.
 */

/** sRGB colour as bytes (0-255 each) plus STRAIGHT (non-premultiplied) alpha (0-1). */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Resolves any CSS `<color>` string to sRGB bytes + alpha, or null when the
 * input is not a colour. The browser implementation is a canvas readback; tests
 * inject a fake.
 */
export interface ColorProbe {
  toRgba(input: string): Rgba | null;
}

const clampByte = (n: number): number =>
  Math.max(0, Math.min(255, Math.round(n)));

const clampAlpha = (n: number): number => {
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
};

const hex2 = (n: number): string => clampByte(n).toString(16).padStart(2, "0");

/** `#rrggbb` (alpha dropped). */
export function rgbaToHex6(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/** `#rrggbbaa` (alpha as a byte). */
export function rgbaToHex8(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${hex2(c.a * 255)}`;
}

/** `rgb(r, g, b)` when opaque, else `rgba(r, g, b, a)`. */
export function rgbaToCss(c: Rgba): string {
  const r = clampByte(c.r);
  const g = clampByte(c.g);
  const b = clampByte(c.b);
  const a = clampAlpha(c.a);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Fully transparent (alpha 0)? — the distinction the old parser erased. */
export function isTransparent(c: Rgba | null): boolean {
  return !!c && clampAlpha(c.a) === 0;
}

/**
 * A canonical, comparable string for a colour: `"transparent"` when fully
 * transparent, otherwise lowercased `#rrggbbaa`. Two syntaxes that resolve to the
 * same pixels (e.g. `oklch(...)` and its `rgb(...)`) canonicalize identically, so
 * the U3 projection can drop an edit that nets back to the original colour.
 * Returns null for a non-colour input.
 */
export function canonicalColor(
  input: string | null,
  probe: ColorProbe,
): string | null {
  if (input == null) return null;
  const c = probe.toRgba(input);
  if (!c) return null;
  return isTransparent(c) ? "transparent" : rgbaToHex8(c).toLowerCase();
}

/**
 * A dependency-free parser for the classic subset (`#hex`, `rgb()/rgba()`,
 * `transparent`). It backs the CSS-less fallback path and is enough for inputs
 * the editor itself writes; the canvas probe covers everything else on real
 * pages. Returns null for anything it does not understand (incl. oklch/lab).
 */
export function parseBasicColor(input: string | null | undefined): Rgba | null {
  if (input == null) return null;
  const t = input.trim().toLowerCase();
  if (t === "") return null;
  if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  // #rgb / #rgba / #rrggbb / #rrggbbaa
  const hex = t.replace(/^#/, "");
  if (/^[0-9a-f]{3,4}$/.test(hex) || /^[0-9a-f]{6}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) {
    if (t.startsWith("#") || /^[0-9a-f]+$/.test(t)) {
      return hexToRgba(hex);
    }
  }

  // rgb(r, g, b) / rgba(r, g, b, a) / rgb(r g b / a)
  const m = t.match(/^rgba?\(([^)]+)\)$/);
  if (m && m[1] != null) {
    const body = m[1].replace(/\//g, " ").replace(/,/g, " ");
    const parts = body.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) return null;
    const chan = (raw: string): number =>
      raw.endsWith("%")
        ? (parseFloat(raw) / 100) * 255
        : parseFloat(raw);
    const r = chan(parts[0]!);
    const g = chan(parts[1]!);
    const b = chan(parts[2]!);
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    let a = 1;
    if (parts[3] != null) {
      a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    }
    return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: clampAlpha(a) };
  }

  return null;
}

function hexToRgba(hex: string): Rgba | null {
  let h = hex;
  if (h.length === 3 || h.length === 4) {
    h = h.split("").map((c) => c + c).join("");
  }
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return { r, g, b, a: clampAlpha(a) };
}

/** The CSS-less fallback probe (classic subset only). */
export const basicProbe: ColorProbe = { toRgba: parseBasicColor };

/**
 * Build the browser probe: a 1x1 canvas whose `fillStyle` the browser resolves to
 * sRGB, read back with `getImageData`. Validity is a two-sentinel `fillStyle`
 * round-trip (an invalid assignment leaves the sentinel, so the two disagree).
 * Falls back to {@link basicProbe} whenever a canvas / 2D context is unavailable
 * (e.g. the node doubles) or a readback throws — it NEVER throws.
 */
export function createCanvasProbe(doc: Document): ColorProbe {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    canvas.width = 1;
    canvas.height = 1;
    const getContext = (canvas as { getContext?: unknown }).getContext as
      | ((id: string, opts?: unknown) => CanvasRenderingContext2D | null)
      | undefined;
    ctx = getContext ? getContext.call(canvas, "2d", { willReadFrequently: true }) : null;
  } catch {
    ctx = null;
  }
  if (!ctx) return basicProbe;
  const cx = ctx;
  return {
    toRgba(input: string): Rgba | null {
      const raw = (input ?? "").trim();
      if (!raw) return null;
      try {
        cx.fillStyle = "#000000";
        cx.fillStyle = raw;
        const first = cx.fillStyle;
        cx.fillStyle = "#ffffff";
        cx.fillStyle = raw;
        const second = cx.fillStyle;
        if (first !== second) return parseBasicColor(raw); // rejected → last resort
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = raw;
        cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        return {
          r: d[0]!,
          g: d[1]!,
          b: d[2]!,
          a: clampAlpha((d[3]! ?? 255) / 255),
        };
      } catch {
        return parseBasicColor(raw);
      }
    },
  };
}
