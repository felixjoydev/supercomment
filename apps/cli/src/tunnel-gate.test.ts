import { describe, expect, it } from "vitest";

import { isTunnelEnabled, TUNNEL_DISABLED_MESSAGE } from "./tunnel-gate.js";

/**
 * The `supercomment start` (tunnel) path is disabled by default (U10 / R17). The
 * CLI dispatch consults isTunnelEnabled before spawning anything; runStart itself
 * is untouched (start.test.ts still calls it directly), so this only exercises
 * the flag + the disabled message.
 */
describe("isTunnelEnabled", () => {
  it("is disabled when the flag is unset", () => {
    expect(isTunnelEnabled({})).toBe(false);
  });

  it("is disabled for empty / falsey spellings (case-insensitive, trimmed)", () => {
    for (const v of ["", "   ", "0", "false", "FALSE", " no ", "off", "OFF"]) {
      expect(isTunnelEnabled({ SUPERCOMMENT_ENABLE_TUNNEL: v })).toBe(false);
    }
  });

  it("is enabled for truthy values", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on", "enabled"]) {
      expect(isTunnelEnabled({ SUPERCOMMENT_ENABLE_TUNNEL: v })).toBe(true);
    }
  });
});

describe("TUNNEL_DISABLED_MESSAGE", () => {
  it("is the exact embedded-mode pointer message", () => {
    expect(TUNNEL_DISABLED_MESSAGE).toBe(
      "Tunnel mode is disabled. Use embedded mode — see docs/embed/install.md.",
    );
  });
});
