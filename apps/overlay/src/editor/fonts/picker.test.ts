import { describe, it, expect, vi } from "vitest";

import { makeFakeDom, FakeElement } from "../../test/dom-double.js";
import {
  FontPicker,
  familyCss,
  reorderRecents,
  createFontEnv,
  type FontPickerOptions,
  type FontPickerEnv,
  type FontCatalog,
  type FontSelection,
} from "./picker.js";
import type { DetectedFont } from "./detect.js";
import { FontRegistry } from "./registry.js";
import type { FetchLike, FontFaceCtor } from "./load.js";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const CATALOG: FontCatalog = {
  version: 1,
  families: [
    { name: "Inter", category: "sans-serif", weights: ["400", "700"] },
    { name: "Roboto", category: "sans-serif", weights: ["400", "500", "700"] },
    { name: "Lora", category: "serif", weights: ["400", "700"] },
  ],
};

const PAGE_FONTS: DetectedFont[] = [
  { family: "Georgia", raw: "Georgia", count: 5, loaded: false, generic: false },
  { family: "sans-serif", raw: "sans-serif", count: 2, loaded: false, generic: true },
];

function fakeEnv(overrides: Partial<FontPickerEnv> = {}): FontPickerEnv {
  return {
    loadCatalog: async () => CATALOG,
    loadFamily: async (family, weights) => ({
      ok: true,
      family,
      weights,
      previewUnavailable: false,
    }),
    uploadCapable: false,
    ...overrides,
  };
}

function setup(over: Partial<FontPickerOptions> = {}) {
  const { doc } = makeFakeDom();
  const container = doc.createElement("div") as unknown as HTMLElement;
  (doc.body as unknown as FakeElement).appendChild(container as unknown as FakeElement);
  const selected: FontSelection[] = [];
  const onClose = vi.fn();
  const opts: FontPickerOptions = {
    doc: doc as unknown as Document,
    container,
    pageFonts: PAGE_FONTS,
    env: fakeEnv(),
    recents: [],
    currentFamily: "",
    onSelect: (s) => selected.push(s),
    onClose,
    ...over,
  };
  const picker = new FontPicker(opts);
  const q = (sel: string) => (container as unknown as FakeElement).querySelectorAll(sel);
  const rows = () => q(".sc-ep-fontrow");
  const groups = () => q(".sc-ep-fontgroup").map((g) => g.textContent);
  const rowByText = (name: string) => rows().find((r) => r.textContent.startsWith(name));
  const search = () => q(".sc-ep-fontsearch")[0]!;
  const weightOpts = () =>
    q(".sc-ep-fontweight-sel")[0]!.querySelectorAll("option").map((o) => o.value);
  const key = (k: string) =>
    search().dispatch("keydown", { key: k, preventDefault() {}, stopPropagation() {} });
  return { doc, container, picker, selected, onClose, q, rows, groups, rowByText, search, weightOpts, key };
}

describe("familyCss / reorderRecents (U8 pure helpers)", () => {
  it("quotes a concrete family and trails a category-appropriate generic", () => {
    expect(familyCss("Inter", "sans-serif")).toBe('"Inter", sans-serif');
    expect(familyCss("Lora", "serif")).toBe('"Lora", serif');
    expect(familyCss("Space Mono", "monospace")).toBe('"Space Mono", monospace');
  });

  it("prepends the pick, dedupes case-insensitively, caps the list", () => {
    expect(reorderRecents(["Roboto", "Lora"], "Inter")).toEqual(["Inter", "Roboto", "Lora"]);
    expect(reorderRecents(["Inter", "Roboto"], "inter")).toEqual(["inter", "Roboto"]);
    expect(reorderRecents(["a", "b", "c", "d", "e"], "x", 3)).toEqual(["x", "a", "b"]);
  });
});

describe("FontPicker (U8)", () => {
  it("renders grouped fonts and filters across groups on search", async () => {
    const h = setup();
    await h.picker.open();
    expect(h.groups()).toContain("This page");
    expect(h.groups()).toContain("Google Fonts");
    expect(h.groups()).toContain("Generic");
    expect(h.rowByText("Georgia")).toBeDefined(); // page
    expect(h.rowByText("Inter")).toBeDefined(); // google

    h.search().value = "rob";
    h.search().dispatch("input", {});
    expect(h.rowByText("Roboto")).toBeDefined();
    expect(h.rowByText("Inter")).toBeUndefined();
    expect(h.rowByText("Georgia")).toBeUndefined();
  });

  it("records a Google pick with the right css + provenance, then closes", async () => {
    const h = setup();
    await h.picker.open();
    h.rowByText("Inter")!.dispatch("click", {});
    await tick();
    expect(h.selected).toHaveLength(1);
    expect(h.selected[0]).toMatchObject({
      family: "Inter",
      css: '"Inter", sans-serif',
      source: "google",
    });
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  it("records a page font without a network load", async () => {
    const loadFamily = vi.fn();
    const h = setup({ env: fakeEnv({ loadFamily }) });
    await h.picker.open();
    h.rowByText("Georgia")!.dispatch("click", {});
    await tick();
    expect(loadFamily).not.toHaveBeenCalled();
    expect(h.selected[0]).toMatchObject({ family: "Georgia", source: "page" });
  });

  it("adapts the weight options to the highlighted family", async () => {
    const h = setup();
    await h.picker.open();
    // Highlight starts on the first candidate (Georgia, page → default 400).
    expect(h.weightOpts()).toEqual(["400"]);
    h.key("ArrowDown"); // move to Inter (google)
    expect(h.weightOpts()).toEqual(["400", "700"]);
  });

  it("completes a selection with the keyboard only (arrows + Enter)", async () => {
    const h = setup();
    await h.picker.open();
    h.key("ArrowDown"); // Georgia -> Inter
    h.key("Enter");
    await tick();
    expect(h.selected[0]?.family).toBe("Inter");
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  it("Escape closes the picker only (no selection)", async () => {
    const h = setup();
    await h.picker.open();
    h.key("Escape");
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.selected).toHaveLength(0);
  });

  it("floats recents into their own top group", async () => {
    const h = setup({ recents: ["Roboto"] });
    await h.picker.open();
    expect(h.groups()[0]).toBe("Recent");
  });

  it("offline (no env) shows only page + generic groups with a usable fallback", async () => {
    const h = setup({ env: null });
    await h.picker.open();
    const g = h.groups();
    expect(g).toContain("This page");
    expect(g).toContain("Generic");
    expect(g).not.toContain("Google Fonts");
    // A generic is still selectable and records the plain keyword (no identity).
    h.rowByText("monospace")!.dispatch("click", {});
    await tick();
    expect(h.selected[0]).toMatchObject({ family: "monospace", css: "monospace", source: "generic" });
  });

  it("marks a failed Google load and still records the choice as previewUnavailable", async () => {
    const loadFamily = vi.fn(async (family: string) => ({
      ok: false,
      family,
      weights: ["400"],
      previewUnavailable: true,
      reason: "csp" as const,
    }));
    const h = setup({ env: fakeEnv({ loadFamily }) });
    await h.picker.open();
    h.rowByText("Inter")!.dispatch("click", {});
    await tick();
    expect(h.selected[0]?.loadResult?.previewUnavailable).toBe(true);
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  it("createFontEnv memoizes the catalog fetch and falls back to null offline", async () => {
    const fetch = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CATALOG),
    }));
    const env = createFontEnv({
      doc: { fonts: { add() {}, delete() {} } } as never,
      fetch: fetch as unknown as FetchLike,
      FontFace: (class {}) as unknown as FontFaceCtor,
      catalogUrl: "https://sc.example/sc/fonts-catalog.json",
      registry: new FontRegistry(),
      uploadCapable: false,
    });
    const a = await env.loadCatalog();
    const b = await env.loadCatalog();
    expect(a?.families).toHaveLength(3);
    expect(b).toBe(a); // memoized — one request
    expect(fetch).toHaveBeenCalledOnce();

    const offline = createFontEnv({
      doc: { fonts: { add() {}, delete() {} } } as never,
      fetch: (async () => {
        throw new Error("blocked");
      }) as unknown as FetchLike,
      FontFace: (class {}) as unknown as FontFaceCtor,
      catalogUrl: "https://sc.example/sc/fonts-catalog.json",
      registry: new FontRegistry(),
      uploadCapable: false,
    });
    expect(await offline.loadCatalog()).toBeNull();
  });

  it("hides the Uploaded group until the session can upload (U9 cut)", async () => {
    const h1 = setup({ env: fakeEnv({ uploadCapable: false }) });
    await h1.picker.open();
    expect(h1.groups()).not.toContain("Uploaded");

    const h2 = setup({ env: fakeEnv({ uploadCapable: true }) });
    await h2.picker.open();
    expect(h2.groups()).toContain("Uploaded");
  });
});
