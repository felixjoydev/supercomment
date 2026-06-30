import { describe, it, expect } from "vitest";

import {
  a11yPathLabel,
  appStateLabel,
  environmentLabel,
  interactionTrailLabel,
  networkLabel,
  surfaceLabel,
} from "../lib/comments/context-summary";

describe("surfaceLabel", () => {
  it("combines surface and viewport size", () => {
    expect(surfaceLabel("mobile", { width: 375, height: 812 })).toBe(
      "mobile · 375×812",
    );
    expect(surfaceLabel("web", undefined)).toBe("web");
  });
  it("is null without a surface", () => {
    expect(surfaceLabel(undefined, { width: 375, height: 812 })).toBeNull();
  });
});

describe("a11yPathLabel", () => {
  it("joins role-or-tag, target first", () => {
    expect(
      a11yPathLabel([
        { tagName: "button", role: "button" },
        { tagName: "div" },
        { tagName: "form", role: "form" },
      ]),
    ).toBe("button › div › form");
  });
  it("is null when empty/absent", () => {
    expect(a11yPathLabel(undefined)).toBeNull();
    expect(a11yPathLabel([])).toBeNull();
  });
});

describe("environmentLabel", () => {
  it("prefixes platform when present", () => {
    expect(environmentLabel({ userAgent: "UA", platform: "macOS" })).toBe(
      "macOS · UA",
    );
    expect(environmentLabel({ userAgent: "UA" })).toBe("UA");
  });
  it("is null without a user agent", () => {
    expect(environmentLabel(undefined)).toBeNull();
  });
});

describe("appStateLabel", () => {
  it("summarises key counts", () => {
    expect(
      appStateLabel({
        localStorageKeys: ["a", "b"],
        sessionStorageKeys: ["c"],
      }),
    ).toBe("2 local · 1 session key(s)");
  });
  it("is null when there are no keys", () => {
    expect(
      appStateLabel({ localStorageKeys: [], sessionStorageKeys: [] }),
    ).toBeNull();
    expect(appStateLabel(undefined)).toBeNull();
  });
});

describe("networkLabel", () => {
  it("counts requests", () => {
    expect(networkLabel([{ url: "x" }, { url: "y" }])).toBe("2 request(s)");
  });
  it("is null when empty", () => {
    expect(networkLabel([])).toBeNull();
    expect(networkLabel(undefined)).toBeNull();
  });
});

describe("interactionTrailLabel", () => {
  it("summarises with count and recent steps", () => {
    expect(
      interactionTrailLabel([
        { type: "click", target: "button#buy", timestamp: "2026-06-29T00:00:00.000Z" },
        { type: "submit", target: "form", timestamp: "2026-06-29T00:00:01.000Z" },
      ]),
    ).toBe("2 action(s): click button#buy → submit form");
  });
  it("truncates to the last 6 steps with an ellipsis prefix", () => {
    const trail = Array.from({ length: 8 }, (_, i) => ({
      type: "click" as const,
      target: `b${i}`,
      timestamp: "2026-06-29T00:00:00.000Z",
    }));
    const label = interactionTrailLabel(trail);
    expect(label).toContain("8 action(s): … → ");
    expect(label).toContain("click b7");
    expect(label).not.toContain("click b1 ");
  });
  it("is null when empty", () => {
    expect(interactionTrailLabel(undefined)).toBeNull();
  });
});
