import { describe, expect, it } from "vitest";

import {
  assertAllowedSupabaseUrl,
  isAllowedSupabaseHost,
} from "./supabase-url.js";

describe("isAllowedSupabaseHost", () => {
  it("accepts the managed Supabase domain and subdomains", () => {
    expect(isAllowedSupabaseHost("supabase.co", {})).toBe(true);
    expect(isAllowedSupabaseHost("abcd1234.supabase.co", {})).toBe(true);
  });

  it("rejects look-alikes (suffix + subdomain attacks)", () => {
    expect(isAllowedSupabaseHost("evil-supabase.co", {})).toBe(false);
    expect(isAllowedSupabaseHost("supabase.co.evil.com", {})).toBe(false);
    expect(isAllowedSupabaseHost("evil.com", {})).toBe(false);
  });

  it("honors an explicit self-host allowlist", () => {
    const env = { SUPERCOMMENT_ALLOWED_SUPABASE_HOSTS: "db.internal, sb.acme.dev" };
    expect(isAllowedSupabaseHost("sb.acme.dev", env)).toBe(true);
    expect(isAllowedSupabaseHost("db.internal", env)).toBe(true);
    expect(isAllowedSupabaseHost("other.dev", env)).toBe(false);
  });
});

describe("assertAllowedSupabaseUrl", () => {
  it("accepts an https managed Supabase URL", () => {
    expect(() =>
      assertAllowedSupabaseUrl("https://abcd1234.supabase.co", {}),
    ).not.toThrow();
  });

  it("rejects non-https (no token over plaintext / downgrade)", () => {
    expect(() =>
      assertAllowedSupabaseUrl("http://abcd1234.supabase.co", {}),
    ).toThrow(/non-https/i);
  });

  it("rejects an unexpected host", () => {
    expect(() => assertAllowedSupabaseUrl("https://evil.com", {})).toThrow(
      /unexpected Supabase host/i,
    );
  });

  it("rejects a malformed URL", () => {
    expect(() => assertAllowedSupabaseUrl("not a url", {})).toThrow(/Invalid/i);
  });

  it("accepts an allow-listed self-hosted https URL", () => {
    expect(() =>
      assertAllowedSupabaseUrl("https://sb.acme.dev", {
        SUPERCOMMENT_ALLOWED_SUPABASE_HOSTS: "sb.acme.dev",
      }),
    ).not.toThrow();
  });
});
