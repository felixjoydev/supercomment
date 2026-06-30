import { describe, it, expect } from "vitest";

import type { DevicePreset } from "@supercomment/shared";

import {
  DeviceMode,
  DEVICE_CHILD_PARAM,
  buildChildUrl,
  isDeviceChild,
} from "./device-mode.js";

const MOBILE: DevicePreset = {
  id: "mobile",
  label: "Mobile",
  surface: "mobile",
  width: 375,
  height: 812,
};

describe("isDeviceChild", () => {
  it("detects the suppress marker", () => {
    expect(isDeviceChild(`?${DEVICE_CHILD_PARAM}=1`)).toBe(true);
    expect(isDeviceChild(`?foo=1&${DEVICE_CHILD_PARAM}=1`)).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isDeviceChild("")).toBe(false);
    expect(isDeviceChild("?foo=1")).toBe(false);
    expect(isDeviceChild(null)).toBe(false);
    expect(isDeviceChild(undefined)).toBe(false);
  });
});

describe("buildChildUrl", () => {
  it("adds the marker and preserves existing query", () => {
    const url = buildChildUrl({
      origin: "https://app.example.com",
      pathname: "/p",
      search: "?x=1",
    });
    expect(url).toContain("https://app.example.com/p?");
    expect(url).toContain("x=1");
    expect(url).toContain(`${DEVICE_CHILD_PARAM}=1`);
  });
  it("returns null for an opaque or missing origin", () => {
    expect(buildChildUrl({ origin: "null", pathname: "/" })).toBeNull();
    expect(buildChildUrl(undefined)).toBeNull();
  });
});

// --- Lifecycle via a tiny fake DOM ----------------------------------------
// VERIFY IN REAL ENV: real iframe load + contentDocument access is browser
// behaviour; here we drive the same code paths with a fake document.

interface FakeEl {
  tagName?: string;
  className: string;
  style: Record<string, string>;
  children: FakeEl[];
  removed: boolean;
  src?: string;
  contentDocument: unknown;
  listeners: Record<string, (e?: unknown) => void>;
  setAttribute(): void;
  addEventListener(t: string, h: (e?: unknown) => void): void;
  append(...k: FakeEl[]): void;
  appendChild(k: FakeEl): FakeEl;
  remove(): void;
  fire(t: string): void;
}

function fakeEl(tag?: string): FakeEl {
  const el: FakeEl = {
    tagName: tag,
    className: "",
    style: {},
    children: [],
    removed: false,
    contentDocument: null,
    listeners: {},
    setAttribute() {},
    addEventListener(t, h) {
      el.listeners[t] = h;
    },
    append(...k) {
      el.children.push(...k);
    },
    appendChild(k) {
      el.children.push(k);
      return k;
    },
    remove() {
      el.removed = true;
    },
    fire(t) {
      el.listeners[t]?.();
    },
  };
  return el;
}

function fakeDoc() {
  const created: FakeEl[] = [];
  return {
    created,
    defaultView: {
      location: {
        origin: "https://app.example.com",
        pathname: "/p",
        search: "",
      },
    },
    createElement(tag: string) {
      const el = fakeEl(tag);
      created.push(el);
      return el;
    },
  };
}

function setup() {
  const doc = fakeDoc();
  const container = fakeEl("div");
  const mounted: Array<{ doc: unknown; destroyed: boolean }> = [];
  const errors: string[] = [];
  const changes: Array<DevicePreset | null> = [];
  const dm = new DeviceMode({
    doc: doc as unknown as Document,
    container: container as unknown as HTMLElement,
    mountChild: (childDoc) => {
      const rec = { doc: childDoc, destroyed: false };
      mounted.push(rec);
      return { destroy: () => (rec.destroyed = true) };
    },
    onError: (m) => errors.push(m),
    onChange: (p) => changes.push(p),
  });
  return { dm, doc, container, mounted, errors, changes };
}

function iframeOf(doc: ReturnType<typeof fakeDoc>): FakeEl {
  const f = doc.created.find((e) => e.tagName === "iframe");
  if (!f) throw new Error("no iframe created");
  return f;
}

describe("DeviceMode lifecycle", () => {
  it("enters, mounts a child on load, and reports active", () => {
    const { dm, doc, container, mounted, changes } = setup();
    dm.enter(MOBILE);
    expect(dm.isActive()).toBe(true);
    expect(container.children.length).toBe(1); // backdrop appended
    expect(changes).toEqual([MOBILE]);

    const iframe = iframeOf(doc);
    expect(iframe.src).toContain(`${DEVICE_CHILD_PARAM}=1`);
    const childDoc = { tag: "child-doc" };
    iframe.contentDocument = childDoc;
    iframe.fire("load");

    expect(mounted.length).toBe(1);
    expect(mounted[0]!.doc).toBe(childDoc);
  });

  it("exits: destroys the child and removes the frame", () => {
    const { dm, doc, container, mounted, changes } = setup();
    dm.enter(MOBILE);
    const iframe = iframeOf(doc);
    iframe.contentDocument = { tag: "child" };
    iframe.fire("load");

    const backdrop = container.children[0]!;
    dm.exit();
    expect(dm.isActive()).toBe(false);
    expect(backdrop.removed).toBe(true);
    expect(mounted[0]!.destroyed).toBe(true);
    expect(changes).toEqual([MOBILE, null]);
  });

  it("fails gracefully when the iframe is cross-origin (no contentDocument)", () => {
    const { dm, doc, container, mounted, errors } = setup();
    dm.enter(MOBILE);
    const iframe = iframeOf(doc);
    iframe.contentDocument = null; // framing blocked / cross-origin
    iframe.fire("load");

    expect(mounted.length).toBe(0);
    expect(errors.length).toBe(1);
    expect(dm.isActive()).toBe(false);
    expect(container.children[0]!.removed).toBe(true);
  });
});
