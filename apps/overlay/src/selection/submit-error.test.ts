import { describe, it, expect } from "vitest";

import { mapSubmitError } from "./submit-error.js";

describe("mapSubmitError", () => {
  it("maps rate_limited (bare and embedded in a raw RPC string)", () => {
    expect(mapSubmitError("rate_limited")).toMatch(/too quickly/i);
    expect(mapSubmitError("ERROR:  rate_limited: 20 per 60s")).toMatch(/too quickly/i);
  });

  it("maps payload_too_large", () => {
    expect(mapSubmitError("payload_too_large")).toMatch(/too large/i);
  });

  it("maps an expired session (no_review_session / invalid_token)", () => {
    expect(mapSubmitError("no_review_session")).toMatch(/expired/i);
    expect(mapSubmitError("invalid_token")).toMatch(/expired/i);
  });

  it("falls back to a generic message for unknown / missing input", () => {
    expect(mapSubmitError()).toMatch(/couldn't save/i);
    expect(mapSubmitError("")).toMatch(/couldn't save/i);
    expect(mapSubmitError("some unmapped database detail")).toMatch(/couldn't save/i);
  });
});
