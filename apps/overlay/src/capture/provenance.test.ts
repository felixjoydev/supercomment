import { describe, it, expect } from "vitest";

import { captureProvenance } from "./provenance.js";

function metaDoc(commit: string | null) {
  return {
    querySelector: (sel: string) =>
      sel === 'meta[name="sc:commit"]'
        ? { getAttribute: (n: string) => (n === "content" ? commit : null) }
        : null,
    documentElement: { getAttribute: () => null },
  };
}

describe("captureProvenance", () => {
  it("captures origin as deployUrl and a SHA-shaped commit from meta", () => {
    const prov = captureProvenance(
      { location: { origin: "https://preview.example.com" } },
      metaDoc("a1b2c3d4e5f6"),
    );
    expect(prov.deployUrl).toBe("https://preview.example.com");
    expect(prov.commit).toBe("a1b2c3d4e5f6");
  });

  it("reads commit from a global when no meta is present", () => {
    const prov = captureProvenance(
      { location: { origin: "https://x.example.com" }, __SC_COMMIT__: "deadbeef" },
      metaDoc(null),
    );
    expect(prov.commit).toBe("deadbeef");
  });

  it("ignores non-SHA-shaped commit values", () => {
    const prov = captureProvenance(
      { location: { origin: "https://x.example.com" } },
      metaDoc("not a commit!"),
    );
    expect(prov.commit).toBeUndefined();
  });

  it("drops an opaque 'null' origin rather than emitting an invalid URL", () => {
    const prov = captureProvenance({ location: { origin: "null" } }, metaDoc(null));
    expect(prov.deployUrl).toBeUndefined();
  });

  it("returns an empty object when nothing is available", () => {
    expect(captureProvenance(undefined, undefined)).toEqual({});
  });
});
