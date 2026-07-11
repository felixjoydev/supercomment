import { describe, it, expect } from "vitest";
import type { CapturedContext, VisualChangeSet } from "./schema.js";
import {
  redactSecrets,
  redactChangeSet,
  redactContextChangeSet,
  containsSecret,
  shannonEntropy,
  SECRET_PATTERNS,
  REDACTION_PLACEHOLDER,
} from "./redaction.js";

describe("redactSecrets", () => {
  it("strips a Bearer token", () => {
    const out = redactSecrets("Authorization: Bearer abc123DEF456ghi789");
    expect(out).toContain(REDACTION_PLACEHOLDER);
    expect(out).not.toContain("abc123DEF456ghi789");
  });

  it("strips a JWT (xxx.yyy.zzz)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactSecrets(`token is ${jwt} end`);
    expect(out).toBe(`token is ${REDACTION_PLACEHOLDER} end`);
    expect(out).not.toContain("eyJ");
  });

  it("strips an AWS access key id", () => {
    const out = redactSecrets("key=AKIAIOSFODNN7EXAMPLE done");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it("strips a labeled AWS secret access key", () => {
    const out = redactSecrets(
      "aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    );
    expect(out).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  });

  it("strips an OpenAI sk- key and GitHub tokens", () => {
    const out = redactSecrets(
      "sk-abcdefghijklmnopqrstuvwx ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    );
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(out).not.toContain("ghp_");
    expect(out).not.toContain("gho_");
  });

  it("strips a long hex blob", () => {
    const out = redactSecrets("hash 0123456789abcdef0123456789abcdef value");
    expect(out).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("strips a high-entropy base64-ish run", () => {
    const secret = "Zx9Kp2Lq7Wv4Nm1Rt6Yb3Hc8Df5Gj0Az+/Qe";
    const out = redactSecrets(`token=${secret}`);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it("strips an email address (basic PII)", () => {
    const out = redactSecrets("contact jane.doe@example.com please");
    expect(out).not.toContain("jane.doe@example.com");
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it("preserves ordinary visible text", () => {
    const text = "Welcome back, please review the dashboard for new comments.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("does not mangle short words that merely look hexy", () => {
    const text = "The cafe served decaf at 9am.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("does not redact a long but low-entropy non-hex run", () => {
    // 36 identical NON-hex chars ('z' is not a hex digit, so the long-hex
    // pattern doesn't apply): long enough for the base64 length gate, but its
    // entropy is ~0, so the entropy gate keeps it.
    const text = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz here";
    expect(redactSecrets(text)).toBe(text);
  });

  it("is idempotent (re-running over redacted text is a no-op)", () => {
    const once = redactSecrets(
      "Bearer abc123DEF456ghi789 and jane@example.com and AKIAIOSFODNN7EXAMPLE",
    );
    const twice = redactSecrets(once);
    expect(twice).toBe(once);
  });

  it("returns falsy input unchanged", () => {
    expect(redactSecrets("")).toBe("");
  });
});

describe("containsSecret", () => {
  it("detects a secret-shaped string", () => {
    expect(containsSecret("Bearer abc123DEF456ghi789")).toBe(true);
  });
  it("detects an email", () => {
    expect(containsSecret("ping me at a@b.co")).toBe(true);
  });
  it("returns false for plain prose", () => {
    expect(containsSecret("hello world")).toBe(false);
  });
});

describe("shannonEntropy", () => {
  it("is zero for a single repeated character", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
  });
  it("is higher for mixed content", () => {
    expect(shannonEntropy("Zx9Kp2Lq7Wv4Nm1")).toBeGreaterThan(3);
  });
});

describe("SECRET_PATTERNS", () => {
  it("is exported as a reusable named list", () => {
    expect(Array.isArray(SECRET_PATTERNS)).toBe(true);
    expect(SECRET_PATTERNS.length).toBeGreaterThan(0);
    for (const p of SECRET_PATTERNS) {
      expect(typeof p.name).toBe("string");
      expect(p.regex).toBeInstanceOf(RegExp);
    }
  });
});

const SECRET = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

describe("redactChangeSet (U8)", () => {
  it("scrubs secret-shaped free-text in op values, node text + attrs; keeps structure", () => {
    const cs: VisualChangeSet = {
      authoredCommit: "deadbeef",
      ops: [
        {
          opId: "o1",
          type: "setText",
          target: { selector: "h1", anchors: [{ type: "id", value: "hero" }] },
          before: "Welcome",
          after: `Contact ${SECRET}`,
        },
        {
          opId: "o2",
          type: "insertNode",
          target: { selector: "section", anchors: [] },
          insertion: { position: "append" },
          node: {
            tag: "a",
            text: `key ${SECRET}`,
            attrs: { href: `https://x?token=${SECRET}`, title: "Ok" },
          },
        },
      ],
    };

    const out = redactChangeSet(cs);
    expect(JSON.stringify(out)).not.toContain(SECRET);
    // Non-secret free-text and all structure are preserved.
    expect(out.ops[0]!.before).toBe("Welcome");
    expect(out.ops[0]!.after).toContain("[redacted]");
    expect(out.ops[0]!.target.selector).toBe("h1");
    expect(out.ops[1]!.node!.attrs!.title).toBe("Ok");
    expect(out.authoredCommit).toBe("deadbeef");
    // Pure: the input is not mutated.
    expect(cs.ops[0]!.after).toBe(`Contact ${SECRET}`);
  });

  it("scrubs the font-identity family + raw stack, keeping source/weights (U7)", () => {
    const cs: VisualChangeSet = {
      ops: [
        {
          opId: "o1",
          type: "setStyle",
          target: { selector: "h1", anchors: [] },
          property: "font-family",
          before: "sans-serif",
          after: `${SECRET}, sans-serif`,
          font: {
            family: `${SECRET}`,
            source: "upload",
            weights: ["400", "700"],
            rawStack: `${SECRET}, sans-serif`,
          },
        },
      ],
    };

    const out = redactChangeSet(cs);
    expect(JSON.stringify(out)).not.toContain(SECRET);
    // Structure (enumerated source + weights) survives.
    expect(out.ops[0]!.font!.source).toBe("upload");
    expect(out.ops[0]!.font!.weights).toEqual(["400", "700"]);
    // Pure: the input is not mutated.
    expect(cs.ops[0]!.font!.family).toBe(`${SECRET}`);
  });
});

describe("redactContextChangeSet (U8)", () => {
  it("redacts the change-set inside a context", () => {
    const ctx = {
      selector: "x",
      anchors: [],
      url: "https://x",
      consoleErrors: [],
      changeSet: {
        ops: [
          {
            opId: "o1",
            type: "setStyle",
            target: { selector: "h1", anchors: [] },
            property: "content",
            before: null,
            after: SECRET,
          },
        ],
      },
    } as unknown as CapturedContext;

    const out = redactContextChangeSet(ctx);
    expect(JSON.stringify(out.changeSet)).not.toContain(SECRET);
  });

  it("returns the context unchanged (same reference) when there is no change-set", () => {
    const plain = {
      selector: "x",
      anchors: [],
      url: "https://x",
      consoleErrors: [],
    } as unknown as CapturedContext;
    expect(redactContextChangeSet(plain)).toBe(plain);
  });
});
