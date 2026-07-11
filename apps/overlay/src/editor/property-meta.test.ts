import { describe, it, expect } from "vitest";

import { getPropertyMeta } from "./property-meta.js";
import { basicProbe } from "./color/normalize.js";

describe("line-height — reads AND writes px (the marquee fix)", () => {
  const m = getPropertyMeta("line-height");
  it("displays the computed px as a bare number", () => {
    expect(m.displayFrom("25.6px")).toBe("25.6");
  });
  it("writes px back (a +1 step is 26.6px, never a 25.6x multiplier)", () => {
    expect(m.toCss("26.6")).toBe("26.6px");
    expect(m.unit).toBe("px");
    expect(m.step).toBe(1);
  });
});

describe("letter-spacing — normal shows 0, before stays normal", () => {
  const m = getPropertyMeta("letter-spacing");
  it("shows 0 for the computed keyword normal", () => {
    expect(m.displayFrom("normal")).toBe("0");
  });
  it("shows the numeric value otherwise", () => {
    expect(m.displayFrom("1.5px")).toBe("1.5");
  });
  it("treats normal and 0 as the same rendered spacing (equal-drop)", () => {
    expect(m.canonical("normal")).toBe(m.canonical("0"));
    expect(m.canonical("normal")).toBe(m.canonical("0px"));
  });
  it("allows negative and steps by 0.5", () => {
    expect(m.allowNegative).toBe(true);
    expect(m.step).toBe(0.5);
  });
});

describe("text-align — a segment always presses", () => {
  const m = getPropertyMeta("text-align");
  it("presses Left for the computed default start on LTR", () => {
    expect(m.matchesOption("left", "start", { direction: "ltr" })).toBe(true);
    expect(m.matchesOption("center", "start", { direction: "ltr" })).toBe(false);
  });
  it("presses Left for a missing/blank computed value (default)", () => {
    expect(m.matchesOption("left", null)).toBe(true);
    expect(m.matchesOption("left", "")).toBe(true);
  });
  it("flips to Right for start on RTL", () => {
    expect(m.matchesOption("right", "start", { direction: "rtl" })).toBe(true);
    expect(m.matchesOption("left", "start", { direction: "rtl" })).toBe(false);
  });
  it("matches an explicit value directly", () => {
    expect(m.matchesOption("center", "center")).toBe(true);
    expect(m.matchesOption("justify", "justify")).toBe(true);
  });
});

describe("alignment defaults", () => {
  it("align-items normal behaves as stretch", () => {
    const m = getPropertyMeta("align-items");
    expect(m.matchesOption("stretch", "normal")).toBe(true);
  });
  it("justify-content normal behaves as flex-start", () => {
    const m = getPropertyMeta("justify-content");
    expect(m.matchesOption("flex-start", "normal")).toBe(true);
  });
});

describe("colour properties canonicalize through the probe", () => {
  const m = getPropertyMeta("color");
  it("uses the probe to compare equivalent colours", () => {
    expect(m.canonical("rgb(255, 0, 0)", { probe: basicProbe })).toBe(
      m.canonical("#ff0000", { probe: basicProbe }),
    );
  });
  it("canonicalizes transparent distinctly", () => {
    expect(m.canonical("transparent", { probe: basicProbe })).toBe("transparent");
  });
});

describe("numeric + fallback registry entries", () => {
  it("font-size writes px", () => {
    expect(getPropertyMeta("font-size").toCss("48")).toBe("48px");
  });
  it("gap writes px", () => {
    expect(getPropertyMeta("gap").toCss("24")).toBe("24px");
  });
  it("an unknown property is a raw pass-through", () => {
    const m = getPropertyMeta("z-index");
    expect(m.kind).toBe("raw");
    expect(m.toCss("10")).toBe("10");
    expect(m.canonical("Auto")).toBe("auto");
  });

  it("R13 effect properties route through the registry (U18)", () => {
    expect(getPropertyMeta("border-radius").toCss("12")).toBe("12px");
    expect(getPropertyMeta("border-top-left-radius").toCss("8")).toBe("8px");
    expect(getPropertyMeta("border-width").toCss("2")).toBe("2px");
    expect(getPropertyMeta("box-shadow").kind).toBe("raw");
    expect(getPropertyMeta("box-shadow").toCss("none")).toBe("none");
    expect(getPropertyMeta("font-style").kind).toBe("keyword");
    expect(getPropertyMeta("border-color").kind).toBe("color");
  });
});
