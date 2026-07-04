import { describe, it, expect } from "vitest";
import {
  pagePathOf,
  pageKeyOf,
  UNKNOWN_PAGE_KEY,
  UNKNOWN_PAGE_LABEL,
} from "./page-path.js";

describe("pagePathOf", () => {
  it("returns the pathname, ignoring query and hash", () => {
    expect(pagePathOf("https://x.dev/pricing")).toBe("/pricing");
    expect(pagePathOf("https://x.dev/pricing?ref=a")).toBe("/pricing");
    expect(pagePathOf("https://x.dev/pricing#top")).toBe("/pricing");
  });

  it("normalizes a trailing slash off, but keeps the root as '/'", () => {
    expect(pagePathOf("https://x.dev/pricing/")).toBe("/pricing");
    expect(pagePathOf("https://x.dev/")).toBe("/");
    expect(pagePathOf("https://x.dev")).toBe("/");
  });

  it("preserves case (paths are case-sensitive)", () => {
    expect(pagePathOf("https://x.dev/Pricing")).toBe("/Pricing");
    expect(pagePathOf("https://x.dev/Pricing")).not.toBe(
      pagePathOf("https://x.dev/pricing"),
    );
  });

  it("returns null for missing or unparseable input", () => {
    expect(pagePathOf(null)).toBeNull();
    expect(pagePathOf(undefined)).toBeNull();
    expect(pagePathOf("")).toBeNull();
    expect(pagePathOf("/relative/path")).toBeNull();
    expect(pagePathOf("not a url")).toBeNull();
  });
});

describe("pageKeyOf", () => {
  it("folds query, hash, and trailing slash into one key", () => {
    const a = pageKeyOf("https://x.dev/pricing");
    for (const url of [
      "https://x.dev/pricing/",
      "https://x.dev/pricing?ref=a",
      "https://x.dev/pricing#top",
      "https://other.dev/pricing", // origin is not part of the key
    ]) {
      expect(pageKeyOf(url).key).toBe(a.key);
    }
    expect(a.key).toBe("/pricing");
    expect(a.label).toBe("/pricing");
  });

  it("labels the root as Home", () => {
    const root = pageKeyOf("https://x.dev/");
    expect(root.key).toBe("/");
    expect(root.label).toBe("Home");
  });

  it("keeps distinct pages in distinct keys, case included", () => {
    expect(pageKeyOf("https://x.dev/a").key).not.toBe(
      pageKeyOf("https://x.dev/b").key,
    );
    expect(pageKeyOf("https://x.dev/Pricing").key).not.toBe(
      pageKeyOf("https://x.dev/pricing").key,
    );
  });

  it("buckets unparseable URLs under the unknown-page group", () => {
    for (const url of [null, undefined, "", "not a url"]) {
      const k = pageKeyOf(url);
      expect(k.key).toBe(UNKNOWN_PAGE_KEY);
      expect(k.label).toBe(UNKNOWN_PAGE_LABEL);
    }
  });
});
