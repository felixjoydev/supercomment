import { describe, it, expect } from "vitest";
import {
  OVERLAY_ASSET_BASE,
  resolveOverlayBundlePath,
  buildLoaderScript,
  buildLoaderResponse,
} from "../lib/overlay-asset";
import { GET } from "../app/sc-loader/route";

/**
 * Unit tests for the overlay static-asset delivery floor (U1). Static public
 * assets aren't unit-testable through the route, so we test the manifest-reading
 * helper + the loader-response logic the route delegates to. (vitest runs in the
 * node environment; `Response`/`Request` are globals on Node 20+.)
 */

describe("resolveOverlayBundlePath (manifest reader)", () => {
  it("returns the /sc/ path for a valid manifest", () => {
    expect(
      resolveOverlayBundlePath({ overlay: "overlay.abc123def456.global.js" }),
    ).toBe("/sc/overlay.abc123def456.global.js");
  });

  it("uses the OVERLAY_ASSET_BASE prefix", () => {
    expect(
      resolveOverlayBundlePath({ overlay: "x.js" }).startsWith(
        OVERLAY_ASSET_BASE + "/",
      ),
    ).toBe(true);
  });

  // Missing/broken build → a clear throw (the route turns this into a 500, not
  // an empty 200).
  const invalid: [string, unknown][] = [
    ["empty object", {}],
    ["missing key", { other: "y" }],
    ["empty string", { overlay: "" }],
    ["non-string", { overlay: 123 }],
    ["null", null],
    ["undefined", undefined],
  ];
  for (const [label, manifest] of invalid) {
    it(`throws a clear error for ${label}`, () => {
      expect(() => resolveOverlayBundlePath(manifest)).toThrow(/manifest/i);
    });
  }

  it("rejects names that try to escape the /sc/ dir", () => {
    expect(() => resolveOverlayBundlePath({ overlay: "../secret.js" })).toThrow();
    expect(() => resolveOverlayBundlePath({ overlay: "a/b.js" })).toThrow();
  });
});

describe("buildLoaderScript", () => {
  it("injects a <script> for the given (absolute) bundle url", () => {
    const url = "https://app.supercomment.dev/sc/overlay.abc.global.js";
    const script = buildLoaderScript(url);
    expect(script).toContain(JSON.stringify(url));
    expect(script).toContain("createElement('script')");
    expect(script).toContain("appendChild");
  });

  it("guards against double-injection (idempotent)", () => {
    expect(buildLoaderScript("https://x/y.js")).toMatch(/__SUPERCOMMENT_LOADER__/);
  });
});

describe("buildLoaderResponse", () => {
  it("serves the loader no-store and references an absolute /sc/ bundle URL", async () => {
    const res = buildLoaderResponse(
      { overlay: "overlay.deadbeefcafe0000.global.js" },
      "https://app.supercomment.dev",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    const body = await res.text();
    expect(body).toContain(
      "https://app.supercomment.dev/sc/overlay.deadbeefcafe0000.global.js",
    );
  });

  it("throws on a missing build manifest", () => {
    expect(() => buildLoaderResponse({}, "https://app.supercomment.dev")).toThrow(
      /manifest/i,
    );
  });
});

describe("GET /sc-loader route handler", () => {
  it("returns a no-store JS response that injects from this host's /sc/", async () => {
    const res = GET(new Request("https://app.supercomment.dev/sc-loader"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    const body = await res.text();
    expect(body).toContain("https://app.supercomment.dev/sc/");
  });
});
