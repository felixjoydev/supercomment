import { describe, it, expect } from "vitest";

import { sanitizeCaptureClone, createRasterizer } from "./rasterize.js";

/**
 * Minimal field/root doubles so the security logic runs in the node test env
 * (jsdom is not always loadable — see vitest.config.ts). `value` is a plain
 * property (set/read like the real reflected value); attributes are a bag.
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

function fakeRoot(fields: unknown[]): Element {
  return { querySelectorAll: () => fields } as unknown as Element;
}

describe("sanitizeCaptureClone", () => {
  it("blanks sensitive input values and removes the value attribute", () => {
    const pwd = fakeField("INPUT", { type: "password", value: "hunter2" });
    const txt = fakeField("INPUT", { type: "text", value: "secret note" });
    const email = fakeField("INPUT", { type: "email", value: "a@b.com" });
    sanitizeCaptureClone(fakeRoot([pwd, txt, email]));
    expect(pwd.value).toBe("");
    expect((pwd.getAttribute as (n: string) => unknown)("value")).toBeNull();
    expect(txt.value).toBe("");
    expect(email.value).toBe("");
  });

  it("clears textarea content", () => {
    const ta = fakeField("TEXTAREA", { text: "typed message" });
    sanitizeCaptureClone(fakeRoot([ta]));
    expect(ta.textContent).toBe("");
  });

  it("leaves non-sensitive inputs (button) untouched so the capture still looks right", () => {
    const btn = fakeField("INPUT", { type: "button", value: "Submit" });
    sanitizeCaptureClone(fakeRoot([btn]));
    expect(btn.value).toBe("Submit");
  });

  it("treats a type-less input as sensitive (default is text)", () => {
    const noType = fakeField("INPUT", { value: "typed" });
    sanitizeCaptureClone(fakeRoot([noType]));
    expect(noType.value).toBe("");
  });

  it("never throws when the root has no querySelectorAll", () => {
    expect(() => sanitizeCaptureClone({} as unknown as Element)).not.toThrow();
  });
});

describe("createRasterizer", () => {
  it("clones, sanitizes, and delegates to serialize; returns its result", async () => {
    const clonedInput = fakeField("INPUT", { type: "text", value: "secret" });
    const clone = { querySelectorAll: () => [clonedInput] };
    const target = {
      cloneNode: () => clone,
      getBoundingClientRect: () => ({ width: 12, height: 7 }),
    };
    let received: unknown = null;
    let receivedBox: unknown = null;
    const serialize = async (c: Element, box: unknown) => {
      received = c;
      receivedBox = box;
      return "data:image/png;base64,AAAA";
    };
    const rasterize = createRasterizer(serialize);
    const out = await rasterize(target as unknown as Element);
    expect(out).toBe("data:image/png;base64,AAAA");
    expect(received).toBe(clone);
    // sanitized BEFORE serialize saw it
    expect(clonedInput.value).toBe("");
    expect(receivedBox).toEqual({ width: 12, height: 7 });
  });

  it("returns null (never throws) when serialize throws (e.g. canvas taint)", async () => {
    const clone = { querySelectorAll: () => [] };
    const target = {
      cloneNode: () => clone,
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
    };
    const rasterize = createRasterizer(async () => {
      throw new Error("SecurityError: tainted canvas");
    });
    await expect(rasterize(target as unknown as Element)).resolves.toBeNull();
  });

  it("returns null when the target cannot be cloned", async () => {
    const rasterize = createRasterizer(async () => "x");
    await expect(rasterize({} as unknown as Element)).resolves.toBeNull();
  });

  it("full-page mode clones documentElement", async () => {
    const docEl = { cloneNode: () => ({ querySelectorAll: () => [] }) };
    const target = {
      ownerDocument: { documentElement: docEl },
      getBoundingClientRect: () => ({ width: 1, height: 1 }),
    };
    let received: unknown = null;
    const rasterize = createRasterizer(
      async (c: Element) => {
        received = c;
        return "ok";
      },
      { fullPage: true },
    );
    const out = await rasterize(target as unknown as Element);
    expect(out).toBe("ok");
    expect(received).not.toBeNull();
  });
});
