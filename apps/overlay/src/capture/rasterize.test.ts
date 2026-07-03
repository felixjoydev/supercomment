import { describe, it, expect } from "vitest";

import { blankSensitiveField } from "./rasterize.js";

/**
 * Minimal field doubles so the security logic runs in the node test env (jsdom
 * is not always loadable — see vitest.config.ts). `value` is a plain property
 * (set/read like the real reflected value); attributes are a bag.
 */
function fakeField(
  tagName: string,
  opts: { type?: string; value?: string; text?: string } = {},
): Record<string, unknown> {
  const attrs: Record<string, string> = {};
  if (opts.type !== undefined) attrs.type = opts.type;
  if (opts.value !== undefined) attrs.value = opts.value;
  return {
    tagName,
    value: opts.value ?? "",
    textContent: opts.text ?? "",
    getAttribute(n: string) {
      return n in attrs ? attrs[n] : null;
    },
    removeAttribute(n: string) {
      delete attrs[n];
    },
  };
}

describe("blankSensitiveField — screenshot PII defense (G1)", () => {
  it("blanks sensitive input values and removes the value attribute", () => {
    const pwd = fakeField("INPUT", { type: "password", value: "hunter2" });
    const txt = fakeField("INPUT", { type: "text", value: "secret note" });
    const email = fakeField("INPUT", { type: "email", value: "a@b.com" });
    for (const f of [pwd, txt, email]) blankSensitiveField(f as unknown as Node);
    expect(pwd.value).toBe("");
    expect((pwd.getAttribute as (n: string) => unknown)("value")).toBeNull();
    expect(txt.value).toBe("");
    expect(email.value).toBe("");
  });

  it("clears textarea content", () => {
    const ta = fakeField("TEXTAREA", { text: "typed message" });
    blankSensitiveField(ta as unknown as Node);
    expect(ta.textContent).toBe("");
  });

  it("leaves non-sensitive inputs (button) untouched so the capture still looks right", () => {
    const btn = fakeField("INPUT", { type: "button", value: "Submit" });
    blankSensitiveField(btn as unknown as Node);
    expect(btn.value).toBe("Submit");
  });

  it("treats a type-less input as sensitive (default is text)", () => {
    const noType = fakeField("INPUT", { value: "typed" });
    blankSensitiveField(noType as unknown as Node);
    expect(noType.value).toBe("");
  });

  it("never throws on a node without element APIs", () => {
    expect(() => blankSensitiveField({} as unknown as Node)).not.toThrow();
  });
});
