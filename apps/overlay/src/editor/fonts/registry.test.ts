import { describe, it, expect } from "vitest";

import { FontRegistry, type RegistryDocLike, type RegistrableFace } from "./registry.js";

function fakeDoc() {
  const deleted: RegistrableFace[] = [];
  const doc: RegistryDocLike & { deleted: RegistrableFace[] } = {
    fonts: {
      delete: (f: RegistrableFace) => {
        deleted.push(f);
        return true;
      },
    },
    deleted,
  };
  return doc;
}

const face = (family: string): RegistrableFace => ({ family });

describe("FontRegistry (U7)", () => {
  it("drains a single document, leaving others tracked", () => {
    const reg = new FontRegistry();
    const a = fakeDoc();
    const b = fakeDoc();
    reg.track(a, face("Inter"));
    reg.track(a, face("Inter"));
    reg.track(b, face("Satoshi"));
    expect(reg.size()).toBe(3);

    reg.drain(a);
    expect(a.deleted).toHaveLength(2);
    expect(reg.size(a)).toBe(0);
    expect(reg.size(b)).toBe(1); // the other document (device-mode child) is untouched
  });

  it("drains every document on session teardown", () => {
    const reg = new FontRegistry();
    const a = fakeDoc();
    const b = fakeDoc();
    reg.track(a, face("Inter"));
    reg.track(b, face("Satoshi"));

    reg.drain();
    expect(a.deleted).toHaveLength(1);
    expect(b.deleted).toHaveLength(1);
    expect(reg.size()).toBe(0);
  });

  it("swallows a delete that throws so teardown always completes", () => {
    const reg = new FontRegistry();
    const doc: RegistryDocLike = {
      fonts: {
        delete: () => {
          throw new Error("boom");
        },
      },
    };
    reg.track(doc, face("Inter"));
    expect(() => reg.drain()).not.toThrow();
    expect(reg.size()).toBe(0);
  });
});
