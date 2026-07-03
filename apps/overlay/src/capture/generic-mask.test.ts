import { describe, it, expect } from "vitest";

import { stripUrlAttrValue } from "./generic.js";

describe("stripUrlAttrValue (M8 surrounding-HTML URL hardening)", () => {
  it("strips the query + fragment from URL-bearing attributes", () => {
    expect(stripUrlAttrValue("src", "https://x/a.png?token=secret")).toBe("https://x/a.png");
    expect(stripUrlAttrValue("href", "/p?a=1#frag")).toBe("/p");
    expect(stripUrlAttrValue("action", "/submit?csrf=abc")).toBe("/submit");
    expect(stripUrlAttrValue("formaction", "/f#x")).toBe("/f");
  });

  it("leaves non-URL attributes untouched (even with ?/# in the value)", () => {
    expect(stripUrlAttrValue("class", "btn?x")).toBe("btn?x");
    expect(stripUrlAttrValue("title", "Who? Me!")).toBe("Who? Me!");
  });

  it("leaves a clean URL untouched", () => {
    expect(stripUrlAttrValue("src", "https://x/a.png")).toBe("https://x/a.png");
  });
});
