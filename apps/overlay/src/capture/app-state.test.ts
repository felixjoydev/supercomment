import { describe, it, expect } from "vitest";

import { appStateSchema } from "@supercomment/shared";

import { captureAppState } from "./app-state.js";

/** Minimal Storage double backed by an ordered key list. */
function fakeStorage(keys: string[]) {
  return {
    get length() {
      return keys.length;
    },
    key(index: number) {
      return keys[index] ?? null;
    },
  };
}

describe("captureAppState", () => {
  it("captures storage KEYS only (never values, never cookies)", () => {
    const state = captureAppState({
      localStorage: fakeStorage(["cart", "ff_newCheckout"]),
      sessionStorage: fakeStorage(["wizardStep"]),
    });
    expect(state).toEqual({
      localStorageKeys: ["cart", "ff_newCheckout"],
      sessionStorageKeys: ["wizardStep"],
    });
    expect(() => appStateSchema.parse(state)).not.toThrow();
  });

  it("redacts a secret-shaped key", () => {
    const state = captureAppState({
      localStorage: fakeStorage(["auth_admin@example.com"]),
      sessionStorage: fakeStorage([]),
    });
    expect(state?.localStorageKeys[0]).toContain("[redacted]");
  });

  it("returns null when no storage is available", () => {
    expect(captureAppState(undefined)).toBeNull();
    expect(captureAppState({})).toBeNull();
  });

  it("degrades to null when storage access throws", () => {
    const throwing = {
      get length(): number {
        throw new Error("SecurityError");
      },
      key() {
        return null;
      },
    };
    expect(captureAppState({ localStorage: throwing })).toBeNull();
  });
});
