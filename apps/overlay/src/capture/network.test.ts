import { describe, it, expect } from "vitest";

import { networkRequestSchema } from "@supercomment/shared";

import { captureNetworkRequests } from "./network.js";

function fakePerformance(entries: unknown[]) {
  return {
    performance: {
      getEntriesByType: (type: string) =>
        type === "resource" ? (entries as never[]) : [],
    },
  };
}

describe("captureNetworkRequests", () => {
  it("maps resource entries and rounds timings", () => {
    const reqs = captureNetworkRequests(
      fakePerformance([
        {
          name: "https://api.example.com/cart",
          initiatorType: "fetch",
          duration: 123.7,
          transferSize: 512,
          startTime: 10.2,
        },
      ]),
    );
    expect(reqs).not.toBeNull();
    expect(reqs?.[0]).toEqual({
      url: "https://api.example.com/cart",
      initiatorType: "fetch",
      duration: 124,
      transferSize: 512,
      startTime: 10,
    });
    expect(() => networkRequestSchema.parse(reqs?.[0])).not.toThrow();
  });

  it("strips the query string (which can carry tokens) keeping origin+path", () => {
    const reqs = captureNetworkRequests(
      fakePerformance([
        { name: "https://api.example.com/x?token=abc123&email=admin@example.com" },
      ]),
    );
    // Query is dropped entirely — short/word-shaped credentials can't survive.
    expect(reqs?.[0]?.url).toBe("https://api.example.com/x");
    expect(reqs?.[0]?.url).not.toContain("token");
    expect(reqs?.[0]?.url).not.toContain("admin@example.com");
  });

  it("keeps only the most recent 20 entries", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `https://api.example.com/r/${i}`,
    }));
    const reqs = captureNetworkRequests(fakePerformance(many));
    expect(reqs?.length).toBe(20);
    expect(reqs?.[0]?.url).toBe("https://api.example.com/r/10");
  });

  it("returns null when Resource Timing is unavailable or empty", () => {
    expect(captureNetworkRequests(undefined)).toBeNull();
    expect(captureNetworkRequests({})).toBeNull();
    expect(captureNetworkRequests(fakePerformance([]))).toBeNull();
  });
});
