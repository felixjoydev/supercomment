/**
 * U8 — the font picker popover.
 *
 * Replaces the generic four-option font-family dropdown with a searchable,
 * grouped, keyboard-navigable picker: the page's real fonts first, then the
 * curated Google catalog, then uploads (when the session can upload), then the
 * CSS generics. Family rows render in their own face once loaded; the weight
 * options adapt to the highlighted family; a family that fails to load carries a
 * degradation badge; the whole thing is operable from the keyboard and returns
 * focus to its trigger on close.
 *
 * It owns only its popover DOM + interaction; it does NOT record edits. On a
 * confirmed pick it calls `onSelect` with the chosen family, the CSS value to
 * write, the provenance, and the weights, and the panel turns that into the
 * font-family op (with the U7 font identity). Loading a Google face and catalog
 * fetching go through the injected {@link FontPickerEnv} so the picker works
 * offline (page + generic groups only) and is unit-tested without a network.
 */
import type { EscapeLayer } from "../escape-stack.js";
import type { DetectedFont } from "./detect.js";
import {
  loadGoogleFont,
  type FontLoadResult,
  type FontDocLike,
  type FontFaceCtor,
  type FetchLike,
} from "./load.js";
import type { FontRegistry } from "./registry.js";
import {
  prepareFontUpload,
  previewUploadedFont,
  MAX_UPLOADED_FONTS_PER_CHANGESET,
  type UploadFileLike,
  type UploadFontFaceCtor,
} from "./upload.js";

/** One curated catalog family (names/categories/weights only — never URLs). */
export interface FontCatalogFamily {
  name: string;
  category: string;
  weights: string[];
}
export interface FontCatalog {
  version: number;
  families: FontCatalogFamily[];
}

/** The result of sniffing + previewing a picked font file (U9). */
export interface UploadPickResult {
  ok: boolean;
  reason?: "not-a-font" | "too-large" | "parse-failed";
  family?: string;
  css?: string;
  weights?: string[];
  /** The bytes + sniffed type to upload at save (present on ok). */
  upload?: { bytes: ArrayBuffer; contentType: string; ext: string };
  /** True above the soft size threshold (warn, do not block). */
  sizeWarning?: boolean;
}

/** The catalog + loader environment, supplied by the controller (null = offline). */
export interface FontPickerEnv {
  /** Fetch (memoized) the curated catalog from our origin; null when unavailable. */
  loadCatalog(): Promise<FontCatalog | null>;
  /** Load a Google family onto the page; resolves with an honest result (U7). */
  loadFamily(
    family: string,
    weights: string[],
    onLate?: (family: string) => void,
  ): Promise<FontLoadResult>;
  /** True when this session may upload font files (U9); drives the Uploaded group. */
  uploadCapable: boolean;
  /** Sniff + instant-preview a picked font file (U9); absent → uploads disabled. */
  previewUpload?(file: UploadFileLike): Promise<UploadPickResult>;
}

/** Provenance of a picked family — mirrors the op's font-identity source, plus generic. */
export type FontSource = "page" | "google" | "upload" | "generic";

/** A confirmed pick handed back to the panel to record. */
export interface FontSelection {
  /** Display family name (or the generic keyword). */
  family: string;
  /** The CSS value to write for `font-family`. */
  css: string;
  source: FontSource;
  /** Weights offered for this family (empty for a generic). */
  weights: string[];
  /** The chosen weight, when a specific one was selected. */
  weight?: string;
  /** The raw computed stack, when the family was normalized from a page artifact. */
  rawStack?: string;
  /** The load result for a Google pick (carries previewUnavailable). */
  loadResult?: FontLoadResult;
  /** The bytes to upload at save, for an uploaded font (U9); fileRef fills on save. */
  upload?: { bytes: ArrayBuffer; contentType: string; ext: string };
}

export interface FontPickerOptions {
  doc: Document;
  /** Where the popover mounts (the panel root). */
  container: HTMLElement;
  /** Element factory (defaults to doc.createElement + className). */
  create?: (tag: string, className?: string) => HTMLElement;
  /** The page's detected fonts (This page group). */
  pageFonts: DetectedFont[];
  /** Catalog + loader environment; null → offline (page + generic only). */
  env: FontPickerEnv | null;
  /** Session recents (families), most-recent first. */
  recents: string[];
  /** The element's current family display name, for the initial highlight. */
  currentFamily: string;
  /** Confirmed pick — the panel records the op. */
  onSelect(sel: FontSelection): void;
  /** The popover closed (selection / Escape / outside) — return focus + drop ref. */
  onClose(): void;
  /** Register the picker's Escape layer with the controller's stack (U2). */
  registerEscape?: (layer: EscapeLayer) => () => void;
  /** Open the OS file picker for a font (U9); default builds a real <input>. */
  openFilePicker?: () => Promise<UploadFileLike | null>;
  /** How many fonts are already uploaded this change-set (drives the cap message). */
  uploadCount?: () => number;
}

/** The CSS generics offered as a fallback group. */
const GENERICS: FontCatalogFamily[] = [
  { name: "sans-serif", category: "generic", weights: [] },
  { name: "serif", category: "generic", weights: [] },
  { name: "monospace", category: "generic", weights: [] },
  { name: "system-ui", category: "generic", weights: [] },
];

/** A sensible fallback generic to trail a concrete family, by catalog category. */
function genericFor(category: string): string {
  if (category === "serif") return "serif";
  if (category === "monospace") return "monospace";
  return "sans-serif";
}

/** The CSS `font-family` value for a concrete family (quoted + a generic trail). */
export function familyCss(family: string, category: string): string {
  return `"${family}", ${genericFor(category)}`;
}

/**
 * Prepend a just-picked family to the recents list (most-recent first), de-duping
 * case-insensitively and capping the list. Pure; the panel/controller keeps the
 * result for the next open.
 */
export function reorderRecents(recents: string[], picked: string, cap = 5): string[] {
  const out = [picked];
  for (const r of recents) {
    if (r.toLowerCase() !== picked.toLowerCase()) out.push(r);
    if (out.length >= cap) break;
  }
  return out;
}

/** A row candidate in the flat, keyboard-navigable list. */
interface Candidate {
  family: string;
  category: string;
  source: FontSource;
  weights: string[];
  rawStack?: string;
}

export class FontPicker {
  private readonly doc: Document;
  private readonly create: (tag: string, className?: string) => HTMLElement;
  private readonly opts: FontPickerOptions;

  private root: HTMLElement | null = null;
  private searchEl!: HTMLInputElement;
  private listEl!: HTMLElement;
  private weightEl!: HTMLSelectElement;

  /** The flat, filtered list backing arrow navigation. */
  private candidates: Candidate[] = [];
  private rowEls: HTMLElement[] = [];
  private highlight = -1;
  /** Families that failed to load this session (degradation badge). */
  private readonly failed = new Set<string>();
  /** A transient message under the upload affordance (rejected file, cap hit). */
  private uploadError: string | null = null;

  private catalog: FontCatalogFamily[] = [];
  private unregisterEscape: (() => void) | null = null;
  private outsideHandler: ((e: unknown) => void) | null = null;
  private closed = false;

  constructor(opts: FontPickerOptions) {
    this.opts = opts;
    this.doc = opts.doc;
    this.create =
      opts.create ??
      ((tag, cls) => {
        const el = this.doc.createElement(tag);
        if (cls) el.className = cls;
        return el;
      });
  }

  /** Build + mount the popover, fetch the catalog, and focus the search field. */
  async open(): Promise<void> {
    this.build();
    this.unregisterEscape = this.opts.registerEscape?.({
      priority: 30, // ESCAPE_PRIORITY.popover
      isActive: () => !this.closed,
      close: () => this.close(),
    }) ?? null;
    this.render("");
    this.searchEl.focus?.();
    // Fetch the catalog lazily; re-render when it arrives (offline → stays empty).
    if (this.opts.env) {
      try {
        const cat = await this.opts.env.loadCatalog();
        if (this.closed) return;
        if (cat?.families) {
          this.catalog = cat.families;
          this.render(this.searchEl.value ?? "");
        }
      } catch {
        /* offline / blocked — page + generic groups still work */
      }
    }
  }

  /** Tear down the popover, return focus to the trigger, and notify the panel. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unregisterEscape?.();
    if (this.outsideHandler) {
      (this.doc as unknown as {
        removeEventListener?: (t: string, cb: (e: unknown) => void, o?: unknown) => void;
      }).removeEventListener?.("pointerdown", this.outsideHandler, true);
    }
    this.root?.remove();
    this.root = null;
    this.opts.onClose();
  }

  // --- DOM ------------------------------------------------------------------

  private build(): void {
    const root = this.create("div", "sc-ep-fontpop");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Choose a font");

    const search = this.create("input", "sc-ep-fontsearch") as HTMLInputElement;
    search.type = "text";
    search.setAttribute("aria-label", "Search fonts");
    search.placeholder = "Search fonts";
    this.searchEl = search;
    this.on(search, "input", () => this.render(search.value ?? ""));
    this.on(search, "keydown", (e) => this.onKey(e));

    const list = this.create("div", "sc-ep-fontlist");
    list.setAttribute("role", "listbox");
    this.listEl = list;
    this.on(list, "keydown", (e) => this.onKey(e));

    const weightWrap = this.create("div", "sc-ep-fontweight");
    const wlabel = this.create("label", "sc-ep-label");
    wlabel.textContent = "Weight";
    const weight = this.create("select", "sc-ep-fontweight-sel") as HTMLSelectElement;
    weight.setAttribute("aria-label", "Font weight");
    this.weightEl = weight;
    weightWrap.append(wlabel, weight);

    root.append(search, list, weightWrap);
    this.opts.container.appendChild(root);
    this.root = root;

    // Outside click dismisses (real DOM; harmless where pointer events are absent).
    this.outsideHandler = (e: unknown): void => {
      const t = (e as { target?: unknown }).target as { closest?: (s: string) => unknown } | null;
      if (t?.closest?.(".sc-ep-fontpop")) return;
      if (t?.closest?.(".sc-ep-fontbtn")) return; // the trigger toggles separately
      this.close();
    };
    (this.doc as unknown as {
      addEventListener?: (t: string, cb: (e: unknown) => void, o?: unknown) => void;
    }).addEventListener?.("pointerdown", this.outsideHandler, true);
  }

  /** Build the grouped candidate list for a search filter and paint the rows. */
  private render(filter: string): void {
    const q = filter.trim().toLowerCase();
    const groups = this.groups();
    this.listEl.replaceChildren?.();
    this.candidates = [];
    this.rowEls = [];

    for (const group of groups) {
      const matches = group.items.filter((c) => c.family.toLowerCase().includes(q));
      const showEmpty =
        matches.length === 0 && (group.alwaysShow === true || group.upload === true) && q === "";
      if (matches.length === 0 && !showEmpty) continue;
      const head = this.create("div", "sc-ep-fontgroup");
      head.setAttribute("role", "presentation");
      head.textContent = group.label;
      this.listEl.appendChild(head);
      if (group.upload && q === "") {
        this.renderUploadAffordance();
        continue;
      }
      if (showEmpty && group.emptyHint) {
        const hint = this.create("div", "sc-ep-fontempty");
        hint.textContent = group.emptyHint;
        this.listEl.appendChild(hint);
        continue;
      }
      for (const c of matches) {
        const row = this.create("button", "sc-ep-fontrow") as HTMLButtonElement;
        row.type = "button";
        row.setAttribute("role", "option");
        row.textContent = c.family;
        if (c.source !== "generic") {
          // Render the row in its own face once available (best-effort inline).
          row.style.fontFamily = familyCss(c.family, c.category);
        }
        if (this.failed.has(c.family.toLowerCase())) this.addBadge(row);
        const index = this.candidates.length;
        this.on(row, "click", () => this.confirm(index));
        this.candidates.push(c);
        this.rowEls.push(row);
        this.listEl.appendChild(row);
      }
    }

    // Re-seat the highlight (prefer the current family, else the first row).
    const cur = this.opts.currentFamily.toLowerCase();
    const preferred = this.candidates.findIndex((c) => c.family.toLowerCase() === cur);
    this.setHighlight(preferred >= 0 ? preferred : this.candidates.length ? 0 : -1);
  }

  /** The ordered, labeled groups: Recent, This page, Google Fonts, Uploaded, Generic. */
  private groups(): Array<{
    label: string;
    items: Candidate[];
    alwaysShow?: boolean;
    emptyHint?: string;
    upload?: boolean;
  }> {
    const pageItems: Candidate[] = this.opts.pageFonts
      .filter((f) => !f.generic)
      .map((f) => ({
        family: f.family,
        category: "sans-serif",
        source: "page" as const,
        weights: [],
        rawStack: f.raw !== f.family ? f.raw : undefined,
      }));
    const pageNames = new Set(pageItems.map((c) => c.family.toLowerCase()));

    const googleItems: Candidate[] = this.catalog.map((c) => ({
      family: c.name,
      category: c.category,
      source: "google" as const,
      weights: c.weights,
    }));
    const byName = new Map(googleItems.map((c) => [c.family.toLowerCase(), c]));

    const recentItems: Candidate[] = [];
    for (const name of this.opts.recents) {
      const key = name.toLowerCase();
      const found = byName.get(key) ?? pageItems.find((c) => c.family.toLowerCase() === key);
      if (found) recentItems.push(found);
    }

    const groups: Array<{
      label: string;
      items: Candidate[];
      alwaysShow?: boolean;
      emptyHint?: string;
      upload?: boolean;
    }> = [];
    if (recentItems.length) groups.push({ label: "Recent", items: recentItems });
    if (pageItems.length) groups.push({ label: "This page", items: pageItems });
    // Google list excludes anything already shown under This page.
    const googleFiltered = googleItems.filter((c) => !pageNames.has(c.family.toLowerCase()));
    if (googleFiltered.length) groups.push({ label: "Google Fonts", items: googleFiltered });
    // Uploaded: only when the session can upload (U9); hidden otherwise so the
    // group is never dead UI. When enabled it renders an upload affordance.
    if (this.opts.env?.uploadCapable && this.opts.env.previewUpload) {
      groups.push({ label: "Uploaded", items: [], alwaysShow: true, upload: true });
    }
    groups.push({
      label: "Generic",
      items: GENERICS.map((g) => ({
        family: g.name,
        category: g.category,
        source: "generic" as const,
        weights: g.weights,
      })),
    });
    return groups;
  }

  // --- Interaction ----------------------------------------------------------

  private onKey(e: unknown): void {
    const ke = e as { key?: string; preventDefault?: () => void; stopPropagation?: () => void };
    const key = ke.key ?? "";
    if (key === "ArrowDown") {
      ke.preventDefault?.();
      this.setHighlight(Math.min(this.candidates.length - 1, this.highlight + 1));
    } else if (key === "ArrowUp") {
      ke.preventDefault?.();
      this.setHighlight(Math.max(0, this.highlight - 1));
    } else if (key === "Enter") {
      ke.preventDefault?.();
      if (this.highlight >= 0) this.confirm(this.highlight);
    } else if (key === "Escape") {
      // Claim the innermost Escape layer: close the picker ONLY, keep the panel.
      ke.preventDefault?.();
      ke.stopPropagation?.();
      this.close();
    }
  }

  private setHighlight(index: number): void {
    this.highlight = index;
    this.rowEls.forEach((el, i) => {
      el.setAttribute("aria-selected", String(i === index));
      if (i === index) el.classList?.add("is-active");
      else el.classList?.remove("is-active");
    });
    // Weight options adapt to the highlighted family (real weights when known).
    const c = this.candidates[index];
    this.fillWeights(c ? c.weights : []);
  }

  private fillWeights(weights: string[]): void {
    const opts = weights.length ? weights : ["400"];
    this.weightEl.replaceChildren?.();
    for (const w of opts) {
      const o = this.create("option") as HTMLOptionElement;
      o.value = w;
      o.textContent = weightLabel(w);
      this.weightEl.appendChild(o);
    }
  }

  /** Confirm the candidate at `index`: load it if needed, hand it back, close. */
  private confirm(index: number): void {
    const c = this.candidates[index];
    if (!c) return;
    const weight = this.weightEl.value || (c.weights[0] ?? "400");

    if (c.source === "generic") {
      this.finish({ family: c.family, css: c.family, source: "generic", weights: [] });
      return;
    }
    if (c.source === "page" || !this.opts.env) {
      this.finish({
        family: c.family,
        css: familyCss(c.family, c.category),
        source: c.source,
        weights: c.weights,
        weight,
        rawStack: c.rawStack,
      });
      return;
    }
    // Google (or upload): load the face, then finish with an honest result.
    void this.confirmLoaded(c, weight);
  }

  private async confirmLoaded(c: Candidate, weight: string): Promise<void> {
    const env = this.opts.env;
    if (!env) return;
    const result = await env.loadFamily(c.family, [weight], (fam) => this.clearFailed(fam));
    if (this.closed) return;
    if (!result.ok) this.markFailed(c.family);
    this.finish({
      family: c.family,
      css: familyCss(c.family, c.category),
      source: c.source,
      // The OFFERED weights are the family's full catalog set (only one weight is
      // loaded for the live preview); fall back to what actually loaded if the
      // catalog listed none.
      weights: c.weights.length ? c.weights : result.weights,
      weight,
      rawStack: c.rawStack,
      loadResult: result,
    });
  }

  private finish(sel: FontSelection): void {
    this.opts.onSelect(sel);
    this.close();
  }

  // --- Uploaded fonts (U9) --------------------------------------------------

  /** Render the Uploaded group's affordance: upload button, notice, cap message. */
  private renderUploadAffordance(): void {
    const wrap = this.create("div", "sc-ep-fontupload-wrap");
    const atCap =
      (this.opts.uploadCount?.() ?? 0) >= MAX_UPLOADED_FONTS_PER_CHANGESET;
    if (atCap) {
      const note = this.create("div", "sc-ep-fontempty");
      note.textContent = `Upload limit reached (${MAX_UPLOADED_FONTS_PER_CHANGESET} per comment).`;
      wrap.appendChild(note);
    } else {
      const btn = this.create("button", "sc-ep-fontupload") as HTMLButtonElement;
      btn.type = "button";
      btn.textContent = "Upload a font file";
      this.on(btn, "click", () => void this.beginUpload());
      const notice = this.create("div", "sc-ep-fontnotice");
      notice.textContent =
        "Only upload fonts you have the right to use. The file is shared with your team's agent.";
      wrap.append(btn, notice);
      if (this.uploadError) {
        const err = this.create("div", "sc-ep-fonterror");
        err.setAttribute("role", "alert");
        err.textContent = this.uploadError;
        wrap.appendChild(err);
      }
    }
    this.listEl.appendChild(wrap);
  }

  /** Pick a font file, sniff + preview it, and finish the selection (U9). */
  private async beginUpload(): Promise<void> {
    const env = this.opts.env;
    if (!env?.previewUpload) return;
    if ((this.opts.uploadCount?.() ?? 0) >= MAX_UPLOADED_FONTS_PER_CHANGESET) return;
    const pick = this.opts.openFilePicker ?? (() => this.defaultOpenFilePicker());
    let file: UploadFileLike | null = null;
    try {
      file = await pick();
    } catch {
      file = null;
    }
    if (!file || this.closed) return;
    let res: UploadPickResult;
    try {
      res = await env.previewUpload(file);
    } catch {
      res = { ok: false, reason: "parse-failed" };
    }
    if (this.closed) return;
    if (!res.ok || !res.family) {
      this.uploadError = uploadErrorText(res.reason);
      this.render(this.searchEl.value ?? "");
      return;
    }
    this.finish({
      family: res.family,
      css: res.css ?? familyCss(res.family, "sans-serif"),
      source: "upload",
      weights: res.weights ?? [],
      upload: res.upload,
    });
  }

  /** The real browser file picker: a transient <input type=file>. */
  private defaultOpenFilePicker(): Promise<UploadFileLike | null> {
    return new Promise((resolve) => {
      const input = this.doc.createElement("input") as HTMLInputElement;
      input.type = "file";
      input.accept = ".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf";
      input.addEventListener("change", () => {
        const f = input.files && input.files[0];
        resolve(f ?? null);
      });
      input.click();
    });
  }

  private markFailed(family: string): void {
    this.failed.add(family.toLowerCase());
  }

  private clearFailed(family: string): void {
    this.failed.delete(family.toLowerCase());
  }

  private addBadge(row: HTMLElement): void {
    const badge = this.create("span", "sc-ep-fontbadge");
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", "This font could not load on the page");
    badge.title = "This font could not load on the page; the choice is still recorded.";
    badge.textContent = "⚠";
    row.appendChild(badge);
  }

  private on(target: unknown, type: string, handler: (e: unknown) => void): void {
    (target as { addEventListener?: (t: string, h: (e: unknown) => void) => void }).addEventListener?.(
      type,
      handler,
    );
  }
}

/** Coerce an untrusted parsed catalog into the picker's shape (defensive). */
function normalizeCatalog(raw: unknown): FontCatalog | null {
  const obj = raw as { version?: unknown; families?: unknown } | null;
  if (!obj || !Array.isArray(obj.families)) return null;
  const families: FontCatalogFamily[] = [];
  for (const f of obj.families as unknown[]) {
    const fam = f as { name?: unknown; category?: unknown; weights?: unknown };
    if (typeof fam.name !== "string" || typeof fam.category !== "string") continue;
    const weights = Array.isArray(fam.weights)
      ? fam.weights.filter((w): w is string => typeof w === "string")
      : [];
    families.push({ name: fam.name, category: fam.category, weights });
  }
  return { version: typeof obj.version === "number" ? obj.version : 1, families };
}

/**
 * Build the picker's catalog + loader environment for the real overlay. The
 * catalog fetch is memoized (one request per session) and coerced defensively;
 * loading a family delegates to the U7 {@link loadGoogleFont} state machine with
 * the session {@link FontRegistry} so added faces are removed on teardown. Returns
 * an env whose `loadCatalog` yields null when the fetch fails (offline fallback).
 */
export function createFontEnv(deps: {
  doc: FontDocLike;
  fetch: FetchLike;
  FontFace: FontFaceCtor;
  catalogUrl: string;
  registry: FontRegistry;
  uploadCapable: boolean;
}): FontPickerEnv {
  let cached: FontCatalog | null | undefined;
  return {
    uploadCapable: deps.uploadCapable,
    async loadCatalog() {
      if (cached !== undefined) return cached;
      try {
        const res = await deps.fetch(deps.catalogUrl);
        cached = res.ok ? normalizeCatalog(JSON.parse(await res.text())) : null;
      } catch {
        cached = null;
      }
      return cached;
    },
    loadFamily(family, weights, onLate) {
      return loadGoogleFont(family, {
        doc: deps.doc,
        fetch: deps.fetch,
        FontFace: deps.FontFace,
        registry: deps.registry,
        weights,
        onLateResolve: onLate,
      });
    },
    async previewUpload(file) {
      const bytes = await file.arrayBuffer();
      const prep = prepareFontUpload({ bytes, fileName: file.name, fileSize: file.size });
      if (!prep.ok) return { ok: false, reason: prep.reason };
      const face = await previewUploadedFont(
        {
          doc: deps.doc as unknown as { fonts: { add(f: never): unknown } },
          FontFace: deps.FontFace as unknown as UploadFontFaceCtor,
          registry: deps.registry,
        },
        prep.family,
        bytes,
      );
      if (!face) return { ok: false, reason: "parse-failed" };
      return {
        ok: true,
        family: prep.family,
        css: familyCss(prep.family, "sans-serif"),
        weights: [],
        upload: { bytes, contentType: prep.contentType, ext: prep.ext },
        sizeWarning: prep.sizeWarning,
      };
    },
  };
}

/** Human-readable copy for a rejected upload. */
function uploadErrorText(reason?: string): string {
  if (reason === "too-large") return "That file is too large (max 10 MB).";
  if (reason === "not-a-font") {
    return "That is not a supported font file (use woff2, woff, ttf, or otf).";
  }
  return "That font could not be read.";
}

/** A short human label for a numeric weight. */
export function weightLabel(w: string): string {
  const map: Record<string, string> = {
    "100": "Thin",
    "200": "Extra Light",
    "300": "Light",
    "400": "Regular",
    "500": "Medium",
    "600": "Semibold",
    "700": "Bold",
    "800": "Extra Bold",
    "900": "Black",
  };
  return map[w] ? `${map[w]} (${w})` : w;
}
