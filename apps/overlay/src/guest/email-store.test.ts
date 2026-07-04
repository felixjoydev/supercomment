import { describe, it, expect } from "vitest";
import type { NameStorage } from "../core/types.js";
import { GuestEmailStore, normalizeEmail } from "./store.js";

function mem(): NameStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("normalizeEmail", () => {
  it("lowercases + trims a plausible address", () => {
    expect(normalizeEmail("  Alex@Foo.COM ")).toBe("alex@foo.com");
  });
  it("rejects implausible input", () => {
    for (const bad of ["", "nope", "a@b", "a b@c.com", "@x.com", "x@", null, undefined]) {
      expect(normalizeEmail(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe("GuestEmailStore", () => {
  it("persists a normalized email per preview and reports has()", () => {
    const storage = mem();
    const store = new GuestEmailStore("host.example", storage);
    expect(store.has()).toBe(false);
    expect(store.set("  Client@Acme.Com ")).toBe("client@acme.com");
    expect(store.has()).toBe(true);
    expect(store.get()).toBe("client@acme.com");
    // A fresh store over the same storage reads the persisted value.
    expect(new GuestEmailStore("host.example", storage).get()).toBe("client@acme.com");
  });

  it("never stores an invalid email (submission stays blocked)", () => {
    const store = new GuestEmailStore("h", mem());
    expect(store.set("nope")).toBeNull();
    expect(store.has()).toBe(false);
  });

  it("scopes storage by preview key", () => {
    const storage = mem();
    new GuestEmailStore("a", storage).set("x@y.com");
    expect(new GuestEmailStore("b", storage).get()).toBeNull();
  });
});
