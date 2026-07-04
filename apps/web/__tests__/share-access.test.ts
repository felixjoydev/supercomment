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

describe("buildEmbeddedRedirectUrl with a page path (U10)", () => {
  it("lands on the given page of an allowlisted deploy", () => {
    expect(
      buildEmbeddedRedirectUrl("https://staging.acme.com", "tok", "/pricing"),
    ).toBe("https://staging.acme.com/pricing#sc_token=tok");
  });
  it("preserves a deploy base path already carried in the page path", () => {
    expect(
      buildEmbeddedRedirectUrl("https://x.vercel.app/app", "tok", "/app/pricing"),
    ).toBe("https://x.vercel.app/app/pricing#sc_token=tok");
  });
  it("keeps the root case unchanged when no page path is given", () => {
    expect(buildEmbeddedRedirectUrl("https://x.vercel.app", "tok", undefined)).toBe(
      "https://x.vercel.app#sc_token=tok",
    );
    expect(buildEmbeddedRedirectUrl("https://x.vercel.app", "tok", "/")).toBe(
      "https://x.vercel.app#sc_token=tok",
    );
  });
  it("never escapes the deploy origin (protocol-relative + traversal de-fanged)", () => {
    expect(
      buildEmbeddedRedirectUrl("https://x.vercel.app", "tok", "//evil.com/x"),
    ).toBe("https://x.vercel.app/evil.com/x#sc_token=tok");
    expect(
      buildEmbeddedRedirectUrl("https://x.vercel.app", "tok", "/../../etc"),
    ).toBe("https://x.vercel.app/etc#sc_token=tok");
  });
  it("still returns null for a non-allowlisted deploy even with a path", () => {
    expect(
      buildEmbeddedRedirectUrl("http://x.vercel.app", "tok", "/pricing"),
    ).toBeNull();
  });
});
