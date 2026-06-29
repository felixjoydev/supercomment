import { describe, it, expect } from "vitest";
import {
  OVERLAY_ASSET_BASE,
  resolveOverlayBundlePath,
  buildLoaderScript,
  buildLoaderResponse,
  bootConfigFromEnv,
  isLoaderEnabled,
  type LoaderBootConfig,
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

describe("bootConfigFromEnv", () => {
  it("maps the host's NEXT_PUBLIC_* env + request origin into the boot config", () => {
    const cfg = bootConfigFromEnv("https://app.supercomment.dev", {
      NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-123",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0xSITEKEY",
    });
    expect(cfg).toEqual({
      backendOrigin: "https://app.supercomment.dev",
      supabaseUrl: "https://proj.supabase.co",
      supabaseAnonKey: "anon-key-123",
      turnstileSiteKey: "0xSITEKEY",
    });
  });

  // Absent keys are omitted (graceful degradation: overlay stays dormant without
  // url/key, sends no Turnstile token without a site key) — but backendOrigin,
  // derived from the request, is always present.
  it("omits absent keys but always sets backendOrigin", () => {
    const cfg = bootConfigFromEnv("https://app.supercomment.dev", {});
    expect(cfg).toEqual({ backendOrigin: "https://app.supercomment.dev" });
    expect(cfg.supabaseUrl).toBeUndefined();
    expect(cfg.supabaseAnonKey).toBeUndefined();
    expect(cfg.turnstileSiteKey).toBeUndefined();
  });
});

describe("buildLoaderScript (boot config + bundle)", () => {
  const boot: LoaderBootConfig = {
    backendOrigin: "https://app.supercomment.dev",
    supabaseUrl: "https://proj.supabase.co",
    supabaseAnonKey: "anon-key-123",
    turnstileSiteKey: "0xSITEKEY",
  };
  const url = "https://app.supercomment.dev/sc/overlay.abc.global.js";

  it("assigns window.__SUPERCOMMENT__ BEFORE injecting the bundle <script>", () => {
    const script = buildLoaderScript(url, boot);
    const assignIdx = script.indexOf("window.__SUPERCOMMENT__ =");
    const bundleIdx = script.indexOf("createElement('script')");
    expect(assignIdx).toBeGreaterThanOrEqual(0);
    expect(bundleIdx).toBeGreaterThan(assignIdx);
  });

  it("emits every boot-config value (anon key is public by design)", () => {
    const script = buildLoaderScript(url, boot);
    expect(script).toContain("https://app.supercomment.dev");
    expect(script).toContain("https://proj.supabase.co");
    expect(script).toContain("anon-key-123");
    expect(script).toContain("0xSITEKEY");
  });

  it("injects a <script> for the given (absolute) bundle url", () => {
    const script = buildLoaderScript(url, boot);
    expect(script).toContain(JSON.stringify(url));
    expect(script).toContain("createElement('script')");
    expect(script).toContain("appendChild");
  });

  it("guards against double-injection (idempotent)", () => {
    expect(buildLoaderScript("https://x/y.js", boot)).toMatch(
      /__SUPERCOMMENT_LOADER__/,
    );
  });
});

describe("isLoaderEnabled (production safety, R18 layer 1)", () => {
  it("is inert on production, active on preview / dev / unset", () => {
    expect(isLoaderEnabled({ NEXT_PUBLIC_VERCEL_ENV: "production" })).toBe(false);
    expect(isLoaderEnabled({ NEXT_PUBLIC_VERCEL_ENV: "preview" })).toBe(true);
    expect(isLoaderEnabled({ NEXT_PUBLIC_VERCEL_ENV: "development" })).toBe(true);
    expect(isLoaderEnabled({})).toBe(true);
  });

  it("honors the explicit production opt-in", () => {
    expect(
      isLoaderEnabled({
        NEXT_PUBLIC_VERCEL_ENV: "production",
        SUPERCOMMENT_ENABLE_IN_PROD: "1",
      }),
    ).toBe(true);
  });
});

describe("buildLoaderResponse", () => {
  const manifest = { overlay: "overlay.deadbeefcafe0000.global.js" };
  const origin = "https://app.supercomment.dev";
  const bundleUrl = `${origin}/sc/overlay.deadbeefcafe0000.global.js`;

  it("serves no-store, emits the boot config, and references the absolute /sc/ bundle URL", async () => {
    const res = buildLoaderResponse(manifest, origin, {
      NEXT_PUBLIC_VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-123",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    const body = await res.text();
    expect(body).toContain("window.__SUPERCOMMENT__");
    expect(body).toContain("https://proj.supabase.co");
    expect(body).toContain(`"backendOrigin":"${origin}"`);
    expect(body).toContain(bundleUrl);
  });

  it("throws on a missing build manifest when enabled", () => {
    expect(() =>
      buildLoaderResponse({}, origin, { NEXT_PUBLIC_VERCEL_ENV: "preview" }),
    ).toThrow(/manifest/i);
  });

  // R18 layer 1: production deploys serve an inert no-op — no bundle, no boot
  // config — but still a valid no-store 200 so the customer's <script> never errors.
  it("serves an inert no-op (no overlay, console note) on production", async () => {
    const res = buildLoaderResponse(manifest, origin, {
      NEXT_PUBLIC_VERCEL_ENV: "production",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).not.toContain("/sc/");
    expect(body).not.toContain("createElement('script')");
    expect(body).not.toContain("window.__SUPERCOMMENT__");
    expect(body).toMatch(/console\.info/);
  });

  it("does NOT read the manifest in the inert branch (prod never 500s on a missing build)", () => {
    expect(() =>
      buildLoaderResponse({}, origin, { NEXT_PUBLIC_VERCEL_ENV: "production" }),
    ).not.toThrow();
  });

  it("re-enables the overlay on production with the explicit opt-in", async () => {
    const res = buildLoaderResponse(manifest, origin, {
      NEXT_PUBLIC_VERCEL_ENV: "production",
      SUPERCOMMENT_ENABLE_IN_PROD: "1",
    });
    const body = await res.text();
    expect(body).toContain(bundleUrl);
    expect(body).toContain("window.__SUPERCOMMENT__");
  });
});

describe("GET /sc-loader route handler", () => {
  // Runs against the real process.env (clean in the test env → non-production →
  // enabled). Verifies the route wires origin → boot config + bundle URL.
  it("returns a no-store JS response with the boot config + a /sc/ bundle from this host", async () => {
    const res = GET(new Request("https://app.supercomment.dev/sc-loader"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    const body = await res.text();
    expect(body).toContain("https://app.supercomment.dev/sc/");
    expect(body).toContain("window.__SUPERCOMMENT__");
    // backendOrigin is derived from the request origin.
    expect(body).toContain('"backendOrigin":"https://app.supercomment.dev"');
  });
});
