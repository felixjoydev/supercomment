import { describe, it, expect } from "vitest";

import { extractPalette, type PaletteSeams } from "./palette.js";
import { basicProbe } from "./normalize.js";

const DOC = {} as unknown as Document;

function seams(over: Partial<PaletteSeams> = {}): PaletteSeams {
  return { probe: basicProbe, stylesheetColors: () => [], elements: [], ...over };
}

describe("extractPalette (U10)", () => {
  it("dedupes equivalent colors on canonical hex8, first-seen order", () => {
    const out = extractPalette(
      DOC,
      seams({
        stylesheetColors: () => [
          "#ff0000",
          "rgb(255, 0, 0)", // same as #ff0000 → deduped
          "#00ff00",
          "rgba(0, 255, 0, 1)", // same as #00ff00 → deduped
        ],
      }),
    );
    expect(out).toEqual(["#ff0000ff", "#00ff00ff"]);
  });

  it("drops fully-transparent values (not a useful swatch)", () => {
    const out = extractPalette(
      DOC,
      seams({ stylesheetColors: () => ["transparent", "rgba(0,0,0,0)", "#123456"] }),
    );
    expect(out).toEqual(["#123456ff"]);
  });

  it("keeps distinct alphas as distinct hex8 swatches", () => {
    const out = extractPalette(
      DOC,
      seams({ stylesheetColors: () => ["rgba(0,0,0,0.5)", "rgb(0,0,0)"] }),
    );
    expect(out).toEqual(["#00000080", "#000000ff"]);
  });

  it("unions stylesheet + computed-scan colors", () => {
    const el = {} as Element;
    const out = extractPalette(
      DOC,
      seams({
        stylesheetColors: () => ["#111111"],
        elements: [el],
        computedColors: () => ["#222222", "#111111"], // #111111 already seen
      }),
    );
    expect(out).toEqual(["#111111ff", "#222222ff"]);
  });

  it("ignores unparseable values (probe returns null)", () => {
    const out = extractPalette(
      DOC,
      seams({ stylesheetColors: () => ["not-a-color", "var(--x)", "#abcabc"] }),
    );
    expect(out).toEqual(["#abcabcff"]);
  });

  it("caps the number of swatches", () => {
    const many = Array.from({ length: 100 }, (_v, i) => `rgb(${i}, 0, 0)`);
    const out = extractPalette(DOC, seams({ stylesheetColors: () => many, maxSwatches: 5 }));
    expect(out).toHaveLength(5);
  });

  it("bounds the computed scan by scanLimit", () => {
    let scanned = 0;
    const elements = Array.from({ length: 50 }, () => ({}) as Element);
    extractPalette(
      DOC,
      seams({
        elements,
        computedColors: () => {
          scanned += 1;
          return ["#000000"];
        },
        scanLimit: 7,
      }),
    );
    expect(scanned).toBe(7);
  });
});
