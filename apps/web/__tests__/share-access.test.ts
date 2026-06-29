import { describe, it, expect } from "vitest";
import {
  classifyMintError,
  generateReviewToken,
  buildEmbeddedRedirectUrl,
} from "../lib/share-access";

describe("classifyMintError", () => {
  it("maps each raised exception to an outcome", () => {
    expect(classifyMintError("login_required")).toBe("login_required");
    expect(classifyMintError("not_embeddable")).toBe("not_embeddable");
    expect(classifyMintError("link_expired")).toBe("link_expired");
    expect(classifyMintError("preview_not_found")).toBe("preview_not_found");
    expect(classifyMintError("access_denied")).toBe("access_denied");
  });
  it("tolerates PostgREST wrapping and casing", () => {
    expect(
      classifyMintError('… RPC error: "LOGIN_REQUIRED" …'),
    ).toBe("login_required");
  });
  it("defaults unknown messages to 'unknown'", () => {
    expect(classifyMintError("boom")).toBe("unknown");
    expect(classifyMintError(null)).toBe("unknown");
    expect(classifyMintError(undefined)).toBe("unknown");
  });
});

describe("generateReviewToken", () => {
  it("produces url-safe high-entropy tokens", () => {
    const t = generateReviewToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(generateReviewToken()).not.toBe(t);
  });
});

describe("buildEmbeddedRedirectUrl", () => {
  it("appends the token in the fragment of an allowlisted https target", () => {
    expect(buildEmbeddedRedirectUrl("https://staging.acme.com", "tok")).toBe(
      "https://staging.acme.com#sc_token=tok",
    );
    expect(buildEmbeddedRedirectUrl("https://staging.acme.com/app/", "t k")).toBe(
      "https://staging.acme.com/app#sc_token=t%20k",
    );
  });
  it("strips any pre-existing fragment before appending", () => {
    expect(buildEmbeddedRedirectUrl("https://x.vercel.app/#old", "tok")).toBe(
      "https://x.vercel.app#sc_token=tok",
    );
  });
  it("returns null for non-allowlisted targets (defense in depth)", () => {
    expect(buildEmbeddedRedirectUrl("http://staging.acme.com", "tok")).toBeNull();
    expect(buildEmbeddedRedirectUrl("https://127.0.0.1", "tok")).toBeNull();
    expect(buildEmbeddedRedirectUrl("https://localhost", "tok")).toBeNull();
  });
});
