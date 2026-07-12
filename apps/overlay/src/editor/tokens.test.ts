import { describe, it, expect } from "vitest";

import { buildTokenIndex, matchToken, type TokenDecl, type TokenMatchSeams } from "./tokens.js";
import { basicProbe, canonicalColor } from "./color/normalize.js";

const DOC = {} as unknown as Document;

/** A color-normalizing matcher seam over an element-resolution map. */
function colorSeams(resolved: Record<string, string>): TokenMatchSeams {
  return {
    normalize: (v) => canonicalColor(v, basicProbe),
    resolveOnElement: (name) => resolved[name] ?? "",
  };
}

describe("buildTokenIndex (U11)", () => {
  it("collects --custom props, deduped first-seen per name", () => {
    const decls: TokenDecl[] = [
      { name: "--brand", value: "#123456" },
      { name: "--brand", value: "#000000" }, // later redeclaration ignored for indexing
      { name: "--accent", value: "var(--brand)" },
      { name: "color", value: "red" }, // not a custom prop
    ];
    const index = buildTokenIndex(DOC, { declarations: () => decls });
    expect(index.map((d) => d.name)).toEqual(["--brand", "--accent"]);
    expect(index[0]!.value).toBe("#123456"); // first declaration kept
  });

  it("returns an empty index when there are no declarations (all cross-origin)", () => {
    expect(buildTokenIndex(DOC, { declarations: () => [] })).toEqual([]);
  });
});

describe("matchToken (U11)", () => {
  const index: TokenDecl[] = [
    { name: "--brand", value: "#3366cc" },
    { name: "--accent", value: "var(--brand)" },
    { name: "--muted", value: "#888888" },
  ];

  it("matches a color to its token via the ELEMENT-resolved value", () => {
    const seams = colorSeams({
      "--brand": "#3366cc",
      "--accent": "#3366cc",
      "--muted": "#888888",
    });
    // Target equals brand; brand + accent both resolve to it, but brand has the
    // shorter var chain (0 vs 1) so it wins.
    expect(matchToken(index, "#3366cc", seams)).toBe("--brand");
  });

  it("returns null when nothing matches", () => {
    const seams = colorSeams({ "--brand": "#3366cc", "--muted": "#888888" });
    expect(matchToken(index, "#ff0000", seams)).toBeNull();
  });

  it("matches the element-resolved value, not the declared root value (theme)", () => {
    // Dark theme: --brand is declared #3366cc at :root but resolves lighter on the
    // element. A pick of the element-resolved value must still name --brand.
    const seams = colorSeams({ "--brand": "#88aaff", "--accent": "#88aaff", "--muted": "#333333" });
    expect(matchToken(index, "rgb(136, 170, 255)", seams)).toBe("--brand");
  });

  it("breaks ties to the shortest var chain, stably", () => {
    const idx: TokenDecl[] = [
      { name: "--a", value: "var(--x)" }, // depth 1
      { name: "--b", value: "#00ff00" }, // depth 0 -> wins
      { name: "--c", value: "var(--y)" }, // depth 1
    ];
    const seams = colorSeams({ "--a": "#00ff00", "--b": "#00ff00", "--c": "#00ff00" });
    expect(matchToken(idx, "#00ff00", seams)).toBe("--b");
    // Stable across the equivalent color syntax.
    expect(matchToken(idx, "rgb(0, 255, 0)", seams)).toBe("--b");
  });

  it("ignores tokens that do not resolve on the element", () => {
    const seams = colorSeams({ "--muted": "#888888" }); // brand/accent resolve to ""
    expect(matchToken(index, "#888888", seams)).toBe("--muted");
  });

  it("disables matching cleanly on an empty index", () => {
    expect(matchToken([], "#3366cc", colorSeams({}))).toBeNull();
  });
});
