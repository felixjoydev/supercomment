import { describe, expect, it } from "vitest";

import { callbackUrl, parseCallbackPort } from "../lib/cli-auth";

describe("parseCallbackPort", () => {
  it("accepts a valid non-privileged TCP port", () => {
    expect(parseCallbackPort("54321")).toBe(54321);
    expect(parseCallbackPort("1024")).toBe(1024);
    expect(parseCallbackPort("65535")).toBe(65535);
  });

  it("rejects missing, non-numeric, privileged, or out-of-range values", () => {
    expect(parseCallbackPort(null)).toBeNull();
    expect(parseCallbackPort(undefined)).toBeNull();
    expect(parseCallbackPort("")).toBeNull();
    expect(parseCallbackPort("0")).toBeNull();
    expect(parseCallbackPort("1")).toBeNull(); // privileged
    expect(parseCallbackPort("1023")).toBeNull(); // privileged
    expect(parseCallbackPort("65536")).toBeNull();
    expect(parseCallbackPort("3000abc")).toBeNull();
    expect(parseCallbackPort("-1")).toBeNull();
    expect(parseCallbackPort("0x1f90")).toBeNull();
    expect(parseCallbackPort("3000.5")).toBeNull();
  });

  it("always targets loopback regardless of port", () => {
    expect(callbackUrl(54321)).toBe("http://127.0.0.1:54321/callback");
  });
});
