import { describe, it, expect } from "vitest";

import {
  detectPageFonts,
  normalizeFamilyName,
  firstFamilyToken,
  isGenericFamily,
  isFallbackArtifact,
  type DetectSeams,
  type FontFaceStatus,
} from "./detect.js";

/** A stand-in Document — detection reads everything through injected seams. */
const DOC = {} as unknown as Document;

/** Build a seam set from a family-per-element map + loaded faces. */
function seams(
  families: string[],
  loaded: FontFaceStatus[] = [],
  extra: Partial<DetectSeams> = {},
): DetectSeams {
  const elements = families.map((f) => ({ __f: f }) as unknown as Element);
  const byEl = new Map(elements.map((el, i) => [el, families[i]!] as const));
  return {
    elements,
    computedFamily: (el) => byEl.get(el) ?? null,
    loadedFaces: () => loaded,
    ...extra,
  };
}

describe("normalizeFamilyName (U7 mangled-name handling)", () => {
  it("normalizes next/font artifacts to a display identity", () => {
    expect(normalizeFamilyName("__Inter_abc123")).toBe("Inter");
    expect(normalizeFamilyName("__Roboto_Mono_e66fe9")).toBe("Roboto Mono");
    expect(normalizeFamilyName("__Inter_Fallback_e66fe9")).toBe("Inter");
  });

  it("leaves ordinary + quoted family names untouched", () => {
    expect(normalizeFamilyName("Inter")).toBe("Inter");
    expect(normalizeFamilyName('"Times New Roman"')).toBe("Times New Roman");
    expect(normalizeFamilyName("system-ui")).toBe("system-ui");
  });
});

describe("firstFamilyToken / isGenericFamily / isFallbackArtifact", () => {
  it("takes the de-quoted primary family of a stack", () => {
    expect(firstFamilyToken('"Inter", sans-serif')).toBe("Inter");
    expect(firstFamilyToken("Georgia, serif")).toBe("Georgia");
    expect(firstFamilyToken(null)).toBe("");
  });

  it("recognizes CSS generics and next/font fallback artifacts", () => {
    expect(isGenericFamily("sans-serif")).toBe(true);
    expect(isGenericFamily("system-ui")).toBe(true);
    expect(isGenericFamily("Inter")).toBe(false);
    expect(isFallbackArtifact("__Inter_Fallback_e66fe9")).toBe(true);
    expect(isFallbackArtifact("__Inter_e66fe9")).toBe(false);
  });
});

describe("detectPageFonts (U7)", () => {
  it("ranks the page's actual rendered families first and marks loaded webfonts", () => {
    const result = detectPageFonts(
      DOC,
      seams(
        ['"Inter", sans-serif', '"Inter", sans-serif', "Georgia, serif"],
        [{ family: "Inter", status: "loaded" }],
      ),
    );
    expect(result[0]!.family).toBe("Inter");
    expect(result[0]!.count).toBe(2);
    expect(result[0]!.loaded).toBe(true);
    expect(result[1]!.family).toBe("Georgia");
    expect(result[1]!.loaded).toBe(false);
  });

  it("lists a system-stack page's dominant rendered family first (no webfonts)", () => {
    const families = [
      ...Array(5).fill("system-ui, sans-serif"),
      "Arial, sans-serif",
    ];
    const result = detectPageFonts(DOC, seams(families, []));
    expect(result[0]!.family).toBe("system-ui");
    expect(result[0]!.count).toBe(5);
    expect(result.some((f) => f.family === "Arial")).toBe(true);
  });

  it("dedupes duplicate FontFace entries (per unicode-range) to one family", () => {
    const result = detectPageFonts(
      DOC,
      seams(
        ['"Inter", sans-serif'],
        [
          { family: "Inter", status: "loaded" },
          { family: "Inter", status: "loaded" },
          { family: "Inter", status: "loaded" },
        ],
      ),
    );
    expect(result.filter((f) => f.family === "Inter")).toHaveLength(1);
  });

  it("normalizes a next/font mangled family in the scan but keeps the raw token", () => {
    const result = detectPageFonts(
      DOC,
      seams(
        ["__Inter_e66fe9, __Inter_Fallback_e66fe9, sans-serif"],
        [{ family: "__Inter_e66fe9", status: "loaded" }],
      ),
    );
    const inter = result.find((f) => f.family === "Inter")!;
    expect(inter).toBeDefined();
    expect(inter.raw).toBe("__Inter_e66fe9");
    expect(inter.loaded).toBe(true);
  });

  it("does not attribute a metric-adjusted fallback as the real webfont (status gate)", () => {
    const result = detectPageFonts(
      DOC,
      seams(
        // the page is rendering the fallback face; only the fallback loaded
        ["__Inter_Fallback_e66fe9, sans-serif"],
        [{ family: "__Inter_Fallback_e66fe9", status: "loaded" }],
        { measure: () => 999 }, // measurement would "confirm" — but must be overridden
      ),
    );
    const inter = result.find((f) => f.family === "Inter")!;
    expect(inter).toBeDefined();
    expect(inter.loaded).toBe(false); // never attributed by measurement alone
    expect(inter.raw).toContain("Fallback"); // raw stack preserved
  });

  it("demotes a declared face that renders identically to the generic baseline", () => {
    const result = detectPageFonts(
      DOC,
      seams(
        ['"Inter", sans-serif'],
        [{ family: "Inter", status: "loaded" }],
        { measure: () => 100 }, // constant width => no metric difference => not confirmed
      ),
    );
    expect(result.find((f) => f.family === "Inter")!.loaded).toBe(false);
  });

  it("bounds the element scan by scanLimit (DoS guard)", () => {
    const families = Array(1000).fill('"Foo", sans-serif');
    const result = detectPageFonts(DOC, seams(families, [], { scanLimit: 10 }));
    expect(result.find((f) => f.family === "Foo")!.count).toBe(10);
  });

  it("includes a loaded family that never surfaced in the element scan", () => {
    const result = detectPageFonts(
      DOC,
      seams(["Georgia, serif"], [{ family: "Satoshi", status: "loaded" }]),
    );
    const satoshi = result.find((f) => f.family === "Satoshi")!;
    expect(satoshi).toBeDefined();
    expect(satoshi.count).toBe(0);
    expect(satoshi.loaded).toBe(true);
  });
});
