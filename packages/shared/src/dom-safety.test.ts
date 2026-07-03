import { describe, it, expect } from "vitest";
import {
  isInsertableTag,
  isEventHandlerAttrName,
  isUrlBearingAttr,
  isSafeUrlValue,
  isSafeAttr,
} from "./dom-safety.js";

describe("isInsertableTag", () => {
  it("allows ordinary presentational + custom-element tags", () => {
    for (const t of ["div", "span", "a", "button", "img", "p", "ul", "my-widget"]) {
      expect(isInsertableTag(t)).toBe(true);
    }
  });

  it("blocks script-capable / external-loading / metadata tags (case-insensitive)", () => {
    for (const t of [
      "script", "SCRIPT", "iframe", "object", "embed", "link", "style",
      "meta", "base", "frame", "frameset", "applet", "template", "noscript",
      "svg", "math", "portal",
    ]) {
      expect(isInsertableTag(t)).toBe(false);
    }
  });

  it("rejects malformed tag names (would only ever come from a hostile payload)", () => {
    for (const t of ["", " ", "img src=x", "a b", "1bad", "<div>", "d/v"]) {
      expect(isInsertableTag(t)).toBe(false);
    }
  });
});

describe("isEventHandlerAttrName", () => {
  it("flags on* handlers (case-insensitive, whitespace-tolerant)", () => {
    for (const n of ["onclick", "onerror", "ONLOAD", " onmouseover", "onpointerdown"]) {
      expect(isEventHandlerAttrName(n)).toBe(true);
    }
  });

  it("does not flag ordinary attributes", () => {
    for (const n of ["class", "href", "title", "data-x", "aria-label"]) {
      expect(isEventHandlerAttrName(n)).toBe(false);
    }
  });
});

describe("isUrlBearingAttr", () => {
  it("recognizes URL attributes (case-insensitive)", () => {
    for (const n of ["href", "src", "SRC", "xlink:href", "action", "formaction", "poster", "srcset"]) {
      expect(isUrlBearingAttr(n)).toBe(true);
    }
  });
  it("does not treat ordinary attributes as URL-bearing", () => {
    for (const n of ["class", "title", "id", "alt"]) {
      expect(isUrlBearingAttr(n)).toBe(false);
    }
  });
});

describe("isSafeUrlValue", () => {
  it("allows ordinary URLs and non-executable raster data URLs", () => {
    for (const v of [
      "https://example.com/x.png",
      "/relative/path",
      "#anchor",
      "mailto:a@b.com",
      "data:image/png;base64,iVBORw0KGgo=",
      "data:image/jpeg,xxxx",
    ]) {
      expect(isSafeUrlValue(v)).toBe(true);
    }
  });

  it("rejects javascript:/vbscript: even when obfuscated with control chars/whitespace", () => {
    for (const v of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "vbscript:msgbox(1)",
    ]) {
      expect(isSafeUrlValue(v)).toBe(false);
    }
  });

  it("rejects script-capable data URLs (text/html, svg)", () => {
    for (const v of [
      "data:text/html,<script>alert(1)</script>",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "data:application/xhtml+xml,x",
    ]) {
      expect(isSafeUrlValue(v)).toBe(false);
    }
  });
});

describe("isSafeAttr", () => {
  it("allows ordinary attributes and safe URL values", () => {
    expect(isSafeAttr("title", "Hello")).toBe(true);
    expect(isSafeAttr("class", "a b c")).toBe(true);
    expect(isSafeAttr("style", "color:red")).toBe(true);
    expect(isSafeAttr("href", "/ok")).toBe(true);
    expect(isSafeAttr("src", "data:image/png;base64,AAAA")).toBe(true);
  });

  it("rejects event handlers, srcdoc, and hostile URL values", () => {
    expect(isSafeAttr("onclick", "steal()")).toBe(false);
    expect(isSafeAttr("onerror", "x")).toBe(false);
    expect(isSafeAttr("srcdoc", "<b>x</b>")).toBe(false);
    expect(isSafeAttr("href", "javascript:alert(1)")).toBe(false);
    expect(isSafeAttr("src", "data:text/html,<script>")).toBe(false);
    expect(isSafeAttr("formaction", "javascript:x")).toBe(false);
    expect(isSafeAttr("", "x")).toBe(false);
  });
});
