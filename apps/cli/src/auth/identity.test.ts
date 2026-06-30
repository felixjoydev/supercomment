import { describe, expect, it } from "vitest";

import { decodeJwtEmail, decodeJwtExp, sanitizeForTerminal } from "./identity.js";

function jwt(payload: object): string {
  return (
    "header." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".sig"
  );
}

describe("decodeJwtEmail", () => {
  it("reads the email claim from the JWT payload", () => {
    expect(decodeJwtEmail(jwt({ email: "dev@example.com", sub: "u1" }))).toBe(
      "dev@example.com",
    );
  });

  it("returns undefined for a token with no email claim", () => {
    expect(decodeJwtEmail(jwt({ sub: "u1" }))).toBeUndefined();
  });

  it("returns undefined for a non-JWT / malformed token", () => {
    expect(decodeJwtEmail("not-a-jwt")).toBeUndefined();
    expect(decodeJwtEmail("a.!!!notbase64json!!!.c")).toBeUndefined();
  });
});

describe("decodeJwtExp", () => {
  it("reads the numeric exp claim", () => {
    expect(decodeJwtExp(jwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000);
  });

  it("returns undefined when exp is missing or non-numeric", () => {
    expect(decodeJwtExp(jwt({ sub: "u1" }))).toBeUndefined();
    expect(decodeJwtExp(jwt({ exp: "soon" }))).toBeUndefined();
    expect(decodeJwtExp("garbage")).toBeUndefined();
  });
});

describe("sanitizeForTerminal", () => {
  it("strips ESC/BEL and other control characters", () => {
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    const NUL = String.fromCharCode(0);
    const input = `ok${ESC}[31mred${BEL}${NUL}done`;
    expect(sanitizeForTerminal(input)).toBe("ok[31mreddone");
  });

  it("leaves ordinary email/text untouched", () => {
    expect(sanitizeForTerminal("dev@example.com")).toBe("dev@example.com");
  });
});
