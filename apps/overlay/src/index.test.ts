import { describe, it, expect } from "vitest";

import { evaluateBoot } from "./index.js";

/**
 * The activation gate (U8/R18/R21): the overlay — and therefore every editor,
 * upload and capture listener — mounts ONLY when this returns a non-`dormant`
 * mode. These tests lock that decision so a regression can't quietly activate
 * the editor on a bare production page.
 */
describe("evaluateBoot — overlay activation gate", () => {
  it("stays dormant on a bare production page (no link secret, no token, no session)", () => {
    expect(evaluateBoot({ token: null, hasLiveSession: false })).toBe("dormant");
  });

  it("activates embedded when a review token is present in the URL", () => {
    expect(evaluateBoot({ token: "tok", hasLiveSession: false })).toBe("embedded");
  });

  it("activates embedded when an unexpired session is persisted (reload path)", () => {
    expect(evaluateBoot({ token: null, hasLiveSession: true })).toBe("embedded");
  });

  it("uses the tunnel path when a link secret is present (legacy), even with a token", () => {
    expect(
      evaluateBoot({ linkSecret: "s", token: null, hasLiveSession: false }),
    ).toBe("tunnel");
    expect(
      evaluateBoot({ linkSecret: "s", token: "tok", hasLiveSession: true }),
    ).toBe("tunnel");
  });

  it("treats an empty/absent link secret as not-tunnel", () => {
    expect(
      evaluateBoot({ linkSecret: "", token: null, hasLiveSession: false }),
    ).toBe("dormant");
    expect(
      evaluateBoot({ linkSecret: null, token: "tok", hasLiveSession: false }),
    ).toBe("embedded");
  });
});
