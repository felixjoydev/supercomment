import { describe, it, expect } from "vitest";

import { createLiveRasterizer, type DomToPng } from "./rasterize-live.js";

const el = (tag: string, attrs: Record<string, string> = {}): Element =>
  ({
    tagName: tag.toUpperCase(),
    getAttribute: (n: string) => attrs[n] ?? null,
  }) as unknown as Element;

describe("createLiveRasterizer", () => {
  it("returns the serializer's PNG data URL", async () => {
    const rasterize = createLiveRasterizer(async () => "data:image/png;base64,AAAA");
    expect(await rasterize(el("div"))).toBe("data:image/png;base64,AAAA");
  });

  it("returns null when the serializer throws (→ DOM-snapshot fallback)", async () => {
    const rasterize = createLiveRasterizer(async () => {
      throw new Error("canvas tainted (cross-origin)");
    });
    expect(await rasterize(el("div"))).toBeNull();
  });

  it("returns null for a non-image result", async () => {
    const rasterize = createLiveRasterizer(async () => "");
    expect(await rasterize(el("div"))).toBeNull();
  });

  it("blanks sensitive field values on each cloned node (G1)", async () => {
    let hook: ((node: Node) => void) | undefined;
    const serialize: DomToPng = async (_node, opts) => {
      hook = opts?.onCloneEachNode;
      return "data:image/png;base64,AAAA";
    };
    await createLiveRasterizer(serialize)(el("section"));
    expect(hook).toBeDefined();

    const field = (tag: string, type?: string) =>
      ({
        tagName: tag.toUpperCase(),
        value: "typed-secret",
        textContent: "typed-secret",
        getAttribute: (n: string) => (n === "type" ? (type ?? null) : null),
        removeAttribute: () => {},
      }) as unknown as Node & { value: string; textContent: string };

    const text = field("input", "text");
    hook!(text);
    expect(text.value).toBe(""); // typed text/email/etc. blanked, not just passwords

    const pwd = field("input", "password");
    hook!(pwd);
    expect(pwd.value).toBe("");

    const area = field("textarea");
    hook!(area);
    expect(area.textContent).toBe("");

    // A non-field node is left untouched and never throws.
    const div = field("div");
    expect(() => hook!(div)).not.toThrow();
    expect(div.value).toBe("typed-secret");
  });
});
