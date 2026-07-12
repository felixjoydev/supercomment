import { describe, it, expect, vi } from "vitest";

import { makeFakeDom, FakeElement } from "../../test/dom-double.js";
import { ColorPicker, rgbToHsv, hsvToRgb, type ColorPickerOptions } from "./picker.js";
import { basicProbe } from "./normalize.js";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<ColorPickerOptions> = {}) {
  const { doc } = makeFakeDom();
  const container = doc.createElement("div") as unknown as HTMLElement;
  (doc.body as unknown as FakeElement).appendChild(container as unknown as FakeElement);
  const changes: string[] = [];
  const picked: string[] = [];
  const onClose = vi.fn();
  const opts: ColorPickerOptions = {
    doc: doc as unknown as Document,
    container,
    probe: basicProbe,
    initial: "#ff0000",
    palette: [],
    recents: [],
    onChange: (css) => changes.push(css),
    onClose,
    onPicked: (hex) => picked.push(hex),
    ...over,
  };
  const picker = new ColorPicker(opts);
  const q = (sel: string) => (container as unknown as FakeElement).querySelector(sel);
  const qa = (sel: string) => (container as unknown as FakeElement).querySelectorAll(sel);
  return { doc, container, picker, changes, picked, onClose, q, qa };
}

describe("rgbToHsv / hsvToRgb (U10)", () => {
  it("converts known colors and round-trips", () => {
    expect(rgbToHsv(255, 0, 0)).toMatchObject({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 255, 0)).toMatchObject({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv(0, 0, 0)).toMatchObject({ s: 0, v: 0 });
    expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsvToRgb(240, 1, 1)).toEqual({ r: 0, g: 0, b: 255 });
    const back = hsvToRgb(rgbToHsv(18, 52, 86).h, rgbToHsv(18, 52, 86).s, rgbToHsv(18, 52, 86).v);
    expect(back).toEqual({ r: 18, g: 52, b: 86 });
  });
});

describe("ColorPicker (U10)", () => {
  it("reflects the initial color in the hex control on open", () => {
    const h = setup({ initial: "#3366cc" });
    h.picker.open();
    expect((h.q(".sc-ep-colorhex") as FakeElement).value).toBe("#3366cc");
  });

  it("the alpha slider writes rgba with the color's own alpha, RGB untouched", () => {
    const h = setup({ initial: "#ff0000" });
    h.picker.open();
    const alpha = h.q(".sc-ep-alpha") as FakeElement;
    alpha.value = "50";
    alpha.dispatch("input", {});
    expect(h.changes.at(-1)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("the hue slider rotates the hue", () => {
    const h = setup({ initial: "#ff0000" });
    h.picker.open();
    const hue = h.q(".sc-ep-hue") as FakeElement;
    hue.value = "120";
    hue.dispatch("input", {});
    expect(h.changes.at(-1)).toBe("rgb(0, 255, 0)");
  });

  it("arrow keys step the saturation/value area (Shift = coarse)", () => {
    const h = setup({ initial: "#ff0000" });
    h.picker.open();
    const sv = h.q(".sc-ep-sv") as FakeElement;
    sv.dispatch("keydown", { key: "ArrowDown", preventDefault() {} }); // v: 1 -> 0.98
    expect(h.changes).toHaveLength(1);
    expect(h.changes[0]).not.toBe("rgb(255, 0, 0)"); // darker red
    sv.dispatch("keydown", { key: "ArrowDown", shiftKey: true, preventDefault() {} }); // v -= 0.1
    expect(h.changes).toHaveLength(2);
  });

  it("commits valid hex/rgba entry and rejects garbage without recording", () => {
    const h = setup({ initial: "#ff0000" });
    h.picker.open();
    const hex = h.q(".sc-ep-colorhex") as FakeElement;
    hex.value = "#0000ff";
    hex.dispatch("change", {});
    expect(h.changes.at(-1)).toBe("rgb(0, 0, 255)");

    const before = h.changes.length;
    hex.value = "nonsense";
    hex.dispatch("change", {});
    expect(h.changes.length).toBe(before); // rejected, nothing recorded
    expect((hex as FakeElement).value).toBe("#0000ff"); // restored to last good
  });

  it("picking a palette swatch records the color as one change", () => {
    const h = setup({ initial: "#ff0000", palette: ["#00ff00ff", "#123456ff"] });
    h.picker.open();
    expect(h.qa(".sc-ep-swatch-btn").length).toBe(2);
    const green = h.qa(".sc-ep-swatch-btn").find((s) => s.getAttribute("aria-label") === "#00ff00ff")!;
    green.dispatch("click", {});
    expect(h.changes).toEqual(["rgb(0, 255, 0)"]);
  });

  it("Escape closes the picker only and records the final color into recents", () => {
    const h = setup({ initial: "#ff0000" });
    h.picker.open();
    const hue = h.q(".sc-ep-hue") as FakeElement;
    hue.value = "240";
    hue.dispatch("input", {});
    (h.q(".sc-ep-sv") as FakeElement).dispatch("keydown", {
      key: "Escape",
      preventDefault() {},
      stopPropagation() {},
    });
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.picked).toEqual(["#0000ffff"]); // final blue committed to recents
  });

  it("does not touch recents when closed without a change", () => {
    const h = setup({ initial: "#ff0000" });
    h.picker.open();
    h.picker.close();
    expect(h.picked).toEqual([]);
  });

  it("hides the eyedropper when the API is missing", () => {
    const h = setup({ hasEyeDropper: () => false });
    h.picker.open();
    expect(h.q(".sc-ep-eyedropper")).toBeNull();
  });

  it("shows a token chip and forwards the token when a pick matches a design token (U11)", () => {
    const tokens: string[] = [];
    const h = setup({
      initial: "#ff0000",
      matchToken: (css) => (css === "rgb(0, 0, 255)" ? "--brand" : null),
      onChange: (_css, token) => tokens.push(token ?? "none"),
    });
    h.picker.open();
    const hex = h.q(".sc-ep-colorhex") as FakeElement;
    hex.value = "#0000ff";
    hex.dispatch("change", {});
    expect(tokens.at(-1)).toBe("--brand");
    expect((h.q(".sc-ep-token-chip") as FakeElement).textContent).toContain("--brand");

    // Moving off the token clears the chip.
    hex.value = "#00ff00";
    hex.dispatch("change", {});
    expect(tokens.at(-1)).toBe("none");
    expect(h.q(".sc-ep-token-chip")).toBeNull();
  });

  it("shows the eyedropper and preserves the current alpha on pick", async () => {
    const h = setup({
      initial: "rgba(255, 0, 0, 0.5)",
      hasEyeDropper: () => true,
      openEyeDropper: async () => "#0000ff", // opaque sRGB from the eyedropper
    });
    h.picker.open();
    const eye = h.q(".sc-ep-eyedropper") as FakeElement;
    expect(eye).not.toBeNull();
    eye.dispatch("click", {});
    await tick();
    expect(h.changes.at(-1)).toBe("rgba(0, 0, 255, 0.5)"); // new hue, prior alpha kept
  });
});
