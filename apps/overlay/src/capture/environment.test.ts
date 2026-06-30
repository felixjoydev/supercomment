import { describe, it, expect } from "vitest";

import { environmentSchema } from "@supercomment/shared";

import { captureEnvironment } from "./environment.js";

describe("captureEnvironment", () => {
  it("captures user agent, language and platform", () => {
    const env = captureEnvironment({
      navigator: {
        userAgent: "Mozilla/5.0 (Test) AppleWebKit",
        language: "en-US",
        userAgentData: { platform: "macOS" },
      },
    });
    expect(env).not.toBeNull();
    expect(env?.userAgent).toContain("Mozilla/5.0");
    expect(env?.language).toBe("en-US");
    expect(env?.platform).toBe("macOS");
    expect(() => environmentSchema.parse(env)).not.toThrow();
  });

  it("falls back to navigator.platform when userAgentData is absent", () => {
    const env = captureEnvironment({
      navigator: { userAgent: "UA", platform: "Win32" },
    });
    expect(env?.platform).toBe("Win32");
  });

  it("returns null without a navigator/userAgent", () => {
    expect(captureEnvironment(undefined)).toBeNull();
    expect(captureEnvironment({})).toBeNull();
    expect(captureEnvironment({ navigator: {} })).toBeNull();
  });
});
