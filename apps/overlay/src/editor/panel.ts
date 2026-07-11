/**
 * The visual-editor properties panel (rebuilt — editor redesign).
 *
 * A dark, right-docked inspector bound to ONE selected element that turns direct
 * manipulations into the semantic `ChangeOp`s of the change-set contract. It is
 * CONTEXT-AWARE: the sections it shows are computed from the element type, so the
 * reviewer only ever sees properties they can actually change on THIS element
 * (requirement A + the user's contextual note):
 *
 *   - text (h1–h6, p, span, a, li…)        → Type settings + Colour
 *   - container (div, section, header…)    → Layout + Spacing + Size + Position + Colour
 *   - other (img, svg, input…)             → Spacing + Size + Position + Colour
 *   - anything with siblings               → Arrange (functional reorder, requirement F)
 *
 * Every control PRE-FILLS from the element's live computed style (requirement B),
 * applies an EPHEMERAL preview to the DOM, and records the semantic property
 * change (before→after + anchored target). The panel holds no durable state — it
 * records into the controller's cross-element history engine via callbacks (each
 * edit ships its DOM redo/undo/revert-to-build closures), so switching elements
 * or modes never loses work (G13/R7); previews persist until an explicit
 * discard/save/exit (U2/U3).
 *
 * Text CONTENT is edited by double-clicking the element (see `inline-text.ts`),
 * not here — the panel is styling only, matching the reference. The insert-node
 * ("Add element") control is intentionally gone (requirement G). Original,
 * clean-room design; every listener is tracked and removed in {@link destroy}.
 */
import type { ChangeOp, DeviceSurface, EditTarget, InsertionPoint } from "@supercomment/shared";

import {
  applyStyleVerified,
  buildStyleOp,
  layoutEditImpliesFlex,
  readComputedColor,
  readComputedValue,
  readInlineSnapshot,
  restoreInlineSnapshot,
  type InlineSnapshot,
} from "./style-edits.js";
import {
  buildMoveOp,
  buildSetVisibilityOp,
  buildSwapMediaOp,
  classifySwapUrl,
  previewHide,
  previewMove,
  previewShow,
  previewSwapMedia,
} from "./structural-edits.js";
import { buildEditTarget } from "./edit-target.js";
import { getPropertyMeta, type PropCtx } from "./property-meta.js";
import { layoutContextFor } from "./layout-context.js";
import type { EditDom, EditListRow } from "./history.js";
import type { EscapeLayer } from "./escape-stack.js";
import { detectPageFonts, firstFamilyToken, normalizeFamilyName } from "./fonts/detect.js";
import {
  FontPicker,
  weightLabel,
  type FontPickerEnv,
  type FontSelection,
} from "./fonts/picker.js";
import {
  createCanvasProbe,
  isTransparent,
  rgbaToHex6,
  rgbaToHex8,
  rgbaToCss,
  canonicalColor,
  type ColorProbe,
} from "./color/normalize.js";
import { ColorPicker } from "./color/picker.js";
import { extractPalette } from "./color/palette.js";
import { buildTokenIndex, matchToken, type TokenDecl } from "./tokens.js";

/** How the controller records edits into (and drives) its history engine (U3). */
export interface PanelCallbacks {
  /** Record one edit plus its DOM redo/undo/revert-to-build closures (U3). */
  record(op: ChangeOp, dom: EditDom): void;
  /** Per-edit revert of a specific recorded edit (edits list / toggle-off). */
  removeEdit(op: ChangeOp): void;
  /** Undo the last history step (footer Undo / Cmd+Z). */
  undo(): void;
  /** Redo the last undone step (footer Redo / Shift+Cmd+Z). */
  redo?(): void;
  /** Throw away ALL in-progress edits + reset to build (explicit Discard all, R7). */
  discard(): void;
  /** Current number of distinct edits, for the footer counter. */
  count(): number;
  /** Whether undo / redo are currently possible (drives the footer button state). */
  canUndo?(): boolean;
  canRedo?(): boolean;
  /** The net edits, as rows for the session review list (R17). */
  entries?(): EditListRow[];
  /** Revert one edit from the review list, by its history key (R17). */
  revertEdit?(key: string): void;
  /** The reviewer closed the panel (× / Esc); previews revert, buffer is kept. */
  onClose(): void;
  /** Finalize the buffered edits as a template comment (opens the comment form). */
  onSave(): void;
  /**
   * Phase 2: true when this session may send to the coding agent — renders the
   * extra "Send to agent" footer button. Guests / non-permitted members: false.
   */
  canSendToAgent?: boolean;
  /** Phase 2: "Send to agent" — save the template AND enqueue it for the agent. */
  onSendToAgent?(): void;
  /**
   * U5 (R1-R3/R6): true for a workspace MEMBER session — renders the private
   * "Prompt for agent" field, independent of `canSendToAgent` (a member without
   * the send-to-agent grant can still author a prompt for someone else to send
   * later from the dashboard). A guest session: false, and the field does not
   * render at all.
   */
  isMember?: boolean;
  /**
   * U5: read ONCE at construction to pre-fill the prompt field, so a reviewer's
   * typed-but-unsaved prompt survives switching to edit a different element
   * within the same edit session. Omit (or return "") for a blank field.
   */
  getPromptText?(): string;
  /** U5: fires on every keystroke in the prompt field with its current value. */
  onPromptChange?(text: string): void;
  /**
   * U6: the reviewed page's origin, so an entered replace-image URL can be
   * classified (same-origin URLs re-apply to other viewers; cross-origin third
   * party is record-intent-only). Omit when unknown.
   */
  pageOrigin?(): string | undefined;
  /**
   * U6: a picked replacement-image file (as a data URL) to deliver to the agent
   * as a signed reference (reusing the reference-image upload channel). The op
   * records the swap intent; this carries the actual bytes safely.
   */
  onSwapImageFile?(dataUrl: string): void;
  /** U6: an element was hidden — its pre-hide rect, so the controller can ghost the slot (U4). */
  onElementHidden?(rect: { x: number; y: number; width: number; height: number }): void;
  /**
   * U8: the font-picker catalog + loader environment (catalog fetch from our
   * origin + Google font loading). Null / absent → the picker runs offline,
   * offering only the page's fonts and the CSS generics.
   */
  fontEnv?: FontPickerEnv | null;
  /**
   * U8: register the font picker's Escape layer with the controller's Escape
   * stack, so Escape closes the OPEN picker only and leaves the panel. Returns an
   * unregister thunk. Absent (tests) → the picker handles Escape locally.
   */
  registerEscapeLayer?(layer: EscapeLayer): () => void;
  /** U8: the session's recently-picked font families (most-recent first). */
  fontRecents?(): string[];
  /** U8: a family was picked; the controller records it into its recents. */
  onFontPicked?(family: string): void;
  /**
   * U9: an uploaded font's bytes for the recorded op (keyed by opId). The
   * controller holds them and uploads at SAVE (so a discard never orphans an
   * object), filling the op's `font.fileRef`. Absent → uploads are unavailable.
   */
  onFontFileUpload?(
    opId: string,
    file: { bytes: ArrayBuffer; contentType: string; ext: string },
  ): void;
  /** U9: how many fonts are already uploaded this change-set (drives the cap). */
  fontUploadCount?(): number;
  /** U10: the session's recently-used colors (hex8, most-recent first). */
  colorRecents?(): string[];
  /** U10: a color was committed; the controller records it into its recents. */
  onColorPicked?(hex8: string): void;
  /** U12: open a history gesture so a resize drag's records coalesce to one step. */
  beginGesture?(): void;
  /** U12: commit the history gesture opened by {@link beginGesture}. */
  commitGesture?(): void;
  /**
   * U14: the device surface these edits are tagged to. Non-"web" surfaces stamp
   * every recorded op's `responsive` field (opKey namespaces by breakpoint, so an
   * edit made at mobile is a distinct op from the same edit at base) and render a
   * surface chip. Absent / "web" → base edits, no tag, no chip.
   */
  surface?: DeviceSurface;
  /** U14: the surface chip label (e.g. "Mobile · 375px"); shown when non-base. */
  surfaceLabel?: string;
}

/** A minimal listener target (both DOM `EventTarget`s and the test doubles). */
interface Listenable {
  addEventListener(type: string, handler: (e: unknown) => void): void;
  removeEventListener?(type: string, handler: (e: unknown) => void): void;
}

/** Which section family an element belongs to (drives the contextual matrix, R6). */
type Category = "text" | "container" | "image" | "media" | "svg" | "form" | "other";

const TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "strong", "em",
  "small", "b", "i", "u", "s", "code", "label", "blockquote", "caption",
  "figcaption", "th", "td", "button", "summary", "cite", "q", "mark", "time",
  "abbr", "dt", "dd", "legend", "pre", "kbd",
]);
const CONTAINER_TAGS = new Set([
  "div", "section", "header", "footer", "nav", "main", "article", "aside", "ul",
  "ol", "form", "figure", "details", "dialog", "fieldset", "table", "thead",
  "tbody", "tr", "menu",
]);
const IMAGE_TAGS = new Set(["img", "picture"]);
const MEDIA_TAGS = new Set(["video", "audio", "canvas"]);
const FORM_TAGS = new Set(["input", "select", "textarea"]);

function categoryOf(el: Element): Category {
  const tag = (el.tagName || "").toLowerCase();
  if (IMAGE_TAGS.has(tag)) return "image";
  if (MEDIA_TAGS.has(tag)) return "media";
  if (tag === "svg") return "svg";
  if (FORM_TAGS.has(tag)) return "form";
  if (TEXT_TAGS.has(tag)) return "text";
  if (CONTAINER_TAGS.has(tag)) return "container";
  return "other";
}

/** The control matrix (R6): which sections render for each element kind. */
interface SectionMatrix {
  type: boolean;
  layout: boolean;
  spacing: boolean;
  size: boolean;
  position: boolean;
  image: boolean;
  colour: false | "color" | "background-color";
}

function sectionsFor(category: Category): SectionMatrix {
  const box = { spacing: true, size: true, position: true };
  switch (category) {
    case "text":
      return { type: true, layout: false, spacing: false, size: false, position: false, image: false, colour: "color" };
    case "container":
      return { type: false, layout: true, ...box, image: false, colour: "background-color" };
    case "image":
      // Image section replaces the meaningless background-color swatch.
      return { type: false, layout: false, ...box, image: true, colour: false };
    case "svg":
      // No background-color on an svg (fill/stroke are out of scope this round).
      return { type: false, layout: false, ...box, image: false, colour: false };
    case "media":
    case "form":
    case "other":
    default:
      return { type: false, layout: false, ...box, image: false, colour: "background-color" };
  }
}

export class PropertiesPanel {
  private readonly root: HTMLElement;
  private readonly disposers: Array<() => void> = [];
  /** Developer-build computed value per property (snapshotted before any preview) — the op `before`. */
  private readonly originalComputed = new Map<string, string | null>();
  /** Preview-revert closure per property (captures original INLINE value, once). */
  private readonly styleReverts = new Map<string, () => void>();
  /** Control re-initializers (read computed → display), re-run on undo. */
  private readonly initializers: Array<() => void> = [];
  private readonly category: Category;
  /** Shared colour-normalization seam (canvas readback on real pages; U1). */
  private readonly colorProbe: ColorProbe;

  /** Which spacing family the 4-side inputs currently edit. */
  private spacingMode: "padding" | "margin" = "padding";
  private spacingLinked = false;

  private countEl!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;
  private sendBtn: HTMLButtonElement | null = null;
  /** The session-review edits list (R17); created lazily when first opened. */
  private editsListEl: HTMLElement | null = null;
  private editsListOpen = false;
  /** U8: the font-picker button + the currently-open picker (one at a time). */
  private fontBtn: HTMLButtonElement | null = null;
  private activePicker: FontPicker | null = null;
  /** U10: the color-picker button(s) by property + the currently-open picker. */
  private readonly colorBtns = new Map<string, HTMLButtonElement>();
  private activeColorPicker: ColorPicker | null = null;

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
    private readonly el: Element,
    private readonly target: EditTarget,
    private readonly cb: PanelCallbacks,
  ) {
    this.category = categoryOf(el);
    this.colorProbe = createCanvasProbe(doc);
    this.root = doc.createElement("div");
    this.root.className = "sc-edit-panel sc-ep-dark";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Edit element");

    const m = sectionsFor(this.category);
    this.buildHeader();
    if (m.type) this.buildTypeSection();
    if (m.layout) this.buildLayoutSection();
    if (m.image) this.buildImageSection();
    if (m.spacing) this.buildSpacingSection();
    if (m.size) this.buildSizeSection();
    if (m.position) this.buildPositionSection();
    if (m.colour) this.buildColourSection(m.colour);
    this.buildEffectsSection(); // radius / border / shadow — applies to any box (R13)
    this.buildArrangeSection();
    this.buildVisibilitySection();
    this.buildFooter();

    parent.appendChild(this.root);
    this.syncControls();
    this.refreshCount();
  }

  /** Remove the panel + every listener it registered (plans/008). */
  destroy(): void {
    this.activePicker?.close(); // U8: tear down an open picker + its Escape layer
    this.activePicker = null;
    this.activeColorPicker?.close(); // U10: tear down an open color picker too
    this.activeColorPicker = null;
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* teardown is best-effort */
      }
    }
    this.root.remove();
  }

  /** Re-read every control from live computed style (initial fill + post-undo re-sync). */
  private syncControls(): void {
    for (const init of this.initializers) {
      try {
        init();
      } catch {
        /* a control that can't read stays at its default */
      }
    }
  }

  // --- Header --------------------------------------------------------------

  private buildHeader(): void {
    const header = this.create("div", "sc-ep-header");

    const handle = this.create("div", "sc-ep-handle");
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "⠿";
    this.enableDrag(handle);

    const tag = this.create("div", "sc-ep-tag");
    tag.textContent = (this.el.tagName || "node").toUpperCase();

    const close = this.button("sc-ep-close", "×", () => this.cb.onClose());
    close.setAttribute("aria-label", "Close editor");
    close.title = this.target.selector;

    const left = this.create("div", "sc-ep-header-left");
    left.append(handle, tag);
    // U14: a device-surface chip so the reviewer always knows their edits are
    // tagged to this breakpoint (only shown off the base "web" surface).
    if (this.surfaceTag()) {
      const chip = this.create("div", "sc-ep-surface-chip");
      chip.textContent = `Editing ${this.cb.surfaceLabel ?? this.surfaceTag()}`;
      chip.setAttribute("aria-label", `Editing on ${this.surfaceTag()}`);
      left.append(chip);
    }
    header.append(left, close);
    this.root.appendChild(header);
  }

  // --- Type settings (text) ------------------------------------------------

  private buildTypeSection(): void {
    const body = this.section("Type settings");
    // U8: the font-family control is now a searchable picker (page fonts + Google
    // catalog + generics), not a five-option dropdown.
    body.appendChild(this.fontRow());
    body.appendChild(
      this.selectRow("Weight", "font-weight", [
        { label: "Light", value: "300" },
        { label: "Regular", value: "400" },
        { label: "Medium", value: "500" },
        { label: "Semibold", value: "600" },
        { label: "Bold", value: "700" },
      ]),
    );
    body.appendChild(this.numberRow("Size", "font-size", { unit: "px", step: 1 }));
    body.appendChild(
      this.numberRow("Letter spacing", "letter-spacing", { unit: "px", step: 0.5, allowNegative: true }),
    );
    // Line height reads AND writes px via the registry (a +1 step from 25.6px is
    // 26.6px, not a 25.6x multiplier — the audited marquee defect).
    body.appendChild(this.numberRow("Line height", "line-height"));
    body.appendChild(
      this.segmentedRow("Alignment", "text-align", [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
        { label: "Justify", value: "justify" },
      ]),
    );
    // U18 (R13): italic, transform, decoration — all through the registry.
    body.appendChild(
      this.segmentedRow("Italic", "font-style", [
        { label: "Normal", value: "normal" },
        { label: "Italic", value: "italic" },
      ]),
    );
    body.appendChild(
      this.segmentedRow("Transform", "text-transform", [
        { label: "None", value: "none" },
        { label: "AG", value: "uppercase" },
        { label: "ag", value: "lowercase" },
        { label: "Ag", value: "capitalize" },
      ]),
    );
    body.appendChild(
      this.segmentedRow("Decoration", "text-decoration-line", [
        { label: "None", value: "none" },
        { label: "Underline", value: "underline" },
        { label: "Strike", value: "line-through" },
      ]),
    );
  }

  // --- Layout (container) --------------------------------------------------

  private buildLayoutSection(): void {
    const body = this.section("Layout");
    body.appendChild(
      this.segmentedRow("Direction", "flex-direction", [
        { label: "Row", value: "row" },
        { label: "Column", value: "column" },
      ], { wide: true, ensureFlex: true }),
    );
    body.appendChild(
      this.selectRow("Align", "align-items", [
        { label: "Start", value: "flex-start" },
        { label: "Center", value: "center" },
        { label: "End", value: "flex-end" },
        { label: "Stretch", value: "stretch" },
        { label: "Baseline", value: "baseline" },
      ], { ensureFlex: true }),
    );
    body.appendChild(
      this.selectRow("Justify", "justify-content", [
        { label: "Start", value: "flex-start" },
        { label: "Center", value: "center" },
        { label: "End", value: "flex-end" },
        { label: "Space between", value: "space-between" },
        { label: "Space around", value: "space-around" },
        { label: "Space evenly", value: "space-evenly" },
      ], { ensureFlex: true }),
    );
    body.appendChild(this.numberRow("Gap", "gap", { unit: "px", step: 1, ensureFlex: true }));
  }

  // --- Spacing (container / other) -----------------------------------------

  private buildSpacingSection(): void {
    const body = this.section("Spacing");

    // Padding / Margin toggle — flips which family the four side inputs edit.
    const toggle = this.create("div", "sc-ep-segmented sc-ep-spacing-toggle");
    const pad = this.segButton("Padding", () => this.setSpacingMode("padding"));
    const mar = this.segButton("Margin", () => this.setSpacingMode("margin"));
    toggle.append(pad, mar);
    body.appendChild(toggle);
    this.initializers.push(() => {
      pad.setAttribute("aria-pressed", String(this.spacingMode === "padding"));
      mar.setAttribute("aria-pressed", String(this.spacingMode === "margin"));
    });

    // Four side inputs in a 2×2 grid, each with a box-side glyph + stepper.
    const grid = this.create("div", "sc-ep-side-grid");
    for (const side of ["top", "right", "bottom", "left"] as const) {
      grid.appendChild(this.sideField(side));
    }
    body.appendChild(grid);

    // Lock — editing one side sets all four.
    const lockRow = this.create("div", "sc-ep-row");
    const lockLabel = this.create("label", "sc-ep-label");
    lockLabel.textContent = "Lock spacing";
    const lock = this.create("button", "sc-ep-switch sc-ep-lock") as HTMLButtonElement;
    lock.type = "button";
    lock.setAttribute("role", "switch");
    lock.setAttribute("aria-checked", "false");
    this.on(lock, "click", () => {
      this.spacingLinked = !this.spacingLinked;
      lock.setAttribute("aria-checked", String(this.spacingLinked));
    });
    lockRow.append(lockLabel, lock);
    body.appendChild(lockRow);
  }

  private setSpacingMode(mode: "padding" | "margin"): void {
    this.spacingMode = mode;
    this.syncControls(); // re-read the four sides for the new family
  }

  /** One side input (top/right/bottom/left) whose property tracks the spacing mode. */
  private sideField(side: "top" | "right" | "bottom" | "left"): HTMLElement {
    const wrap = this.create("div", `sc-ep-num sc-ep-side sc-ep-side-${side}`);
    const glyph = this.create("span", `sc-ep-side-glyph sc-ep-side-glyph-${side}`);
    glyph.setAttribute("aria-hidden", "true");
    const input = this.create("input", `sc-ep-number sc-ep-ctl-${side}`) as HTMLInputElement;
    input.type = "number";
    input.setAttribute("aria-label", `${side} spacing`);
    const propOf = (): string => `${this.spacingMode}-${side}`;

    const commit = (raw: string): void => {
      if (raw.trim() === "") return;
      const value = `${raw}px`;
      if (this.spacingLinked) {
        for (const s of ["top", "right", "bottom", "left"] as const) {
          this.recordStyle(`${this.spacingMode}-${s}`, value);
        }
        this.syncControls();
      } else {
        this.recordStyle(propOf(), value);
      }
    };
    this.on(input, "input", () => commit(input.value));

    const stepper = this.stepper(
      () => this.bump(input, 1, false, commit),
      () => this.bump(input, -1, false, commit),
    );
    wrap.append(glyph, input, stepper);

    this.initializers.push(() => {
      input.value = this.readNumber(propOf());
    });
    return wrap;
  }

  // --- Size (container / other) --------------------------------------------

  private buildSizeSection(): void {
    const body = this.section("Size");
    body.appendChild(this.sizeRow("W", "width"));
    body.appendChild(this.sizeRow("H", "height"));
  }

  /** A dimension row: label + number + Fixed/Auto mode. Auto → `<dim>: auto`. */
  private sizeRow(label: string, property: "width" | "height"): HTMLElement {
    const row = this.create("div", "sc-ep-row");
    const lab = this.create("label", "sc-ep-label sc-ep-dim-label");
    lab.textContent = label;

    const numWrap = this.create("div", `sc-ep-num sc-ep-ctl-${property}-wrap`);
    const input = this.create("input", `sc-ep-number sc-ep-ctl-${property}`) as HTMLInputElement;
    input.type = "number";
    input.setAttribute("aria-label", `${property}`);
    const stepper = this.stepper(
      () => this.bump(input, 1, false, (raw) => this.recordStyle(property, `${raw}px`)),
      () => this.bump(input, -1, false, (raw) => this.recordStyle(property, `${raw}px`)),
    );
    numWrap.append(input, stepper);

    const mode = this.create("select", `sc-ep-select sc-ep-dim-mode sc-ep-ctl-${property}-mode`) as HTMLSelectElement;
    for (const opt of [{ label: "Fixed", value: "fixed" }, { label: "Auto", value: "auto" }]) {
      const o = this.create("option") as HTMLOptionElement;
      o.value = opt.value;
      o.textContent = opt.label;
      mode.appendChild(o);
    }

    const commitFixed = (raw: string): void => {
      if (raw.trim() === "") return;
      this.recordStyle(property, `${raw}px`);
    };
    this.on(input, "input", () => {
      if (mode.value === "fixed") commitFixed(input.value);
    });
    this.on(mode, "change", () => {
      const auto = mode.value === "auto";
      input.disabled = auto;
      if (auto) this.recordStyle(property, "auto");
      else if (input.value.trim() !== "") commitFixed(input.value);
    });

    row.append(lab, numWrap, mode);
    this.initializers.push(() => {
      const computed = readComputedValue(this.el, property);
      const auto = computed == null || computed === "auto";
      mode.value = auto ? "auto" : "fixed";
      input.disabled = auto;
      input.value = auto ? "" : this.readNumber(property);
    });
    return row;
  }

  // --- Position (container / other) — place-self cross picker ---------------

  private buildPositionSection(): void {
    const body = this.section("Position");
    const cross = this.create("div", "sc-ep-cross");
    // 4 edges + centre → a place-self combination (align-self / justify-self).
    const anchors: Array<{ pos: string; value: string; label: string }> = [
      { pos: "top", value: "start center", label: "Top" },
      { pos: "left", value: "center start", label: "Left" },
      { pos: "center", value: "center center", label: "Center" },
      { pos: "right", value: "center end", label: "Right" },
      { pos: "bottom", value: "end center", label: "Bottom" },
    ];
    const dots: HTMLButtonElement[] = [];
    for (const a of anchors) {
      const dot = this.create("button", `sc-ep-cross-dot sc-ep-cross-${a.pos}`) as HTMLButtonElement;
      dot.type = "button";
      dot.setAttribute("aria-label", `Align ${a.label}`);
      this.on(dot, "click", () => {
        this.recordStyle("place-self", a.value);
        for (const d of dots) d.setAttribute("aria-pressed", String(d === dot));
      });
      dots.push(dot);
      cross.appendChild(dot);
    }
    body.appendChild(cross);
  }

  // --- Colour (all) --------------------------------------------------------

  private buildColourSection(property: "color" | "background-color"): void {
    const body = this.section("Colour");
    body.appendChild(this.colorButtonRow(property === "color" ? "Text" : "Fill", property));
  }

  /**
   * A labeled color control (U10): a picker-opening button showing the current
   * color as a swatch + hex. Shared by the Colour section and the Effects border
   * color (which U18 left for this picker). Alpha-capable, palette + recents.
   */
  private colorButtonRow(label: string, property: string): HTMLElement {
    const row = this.create("div", "sc-ep-row sc-ep-colour-row");
    const lab = this.create("label", "sc-ep-label");
    lab.textContent = label;
    const btn = this.create("button", `sc-ep-colorbtn sc-ep-ctl-${property}`) as HTMLButtonElement;
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-label", label);
    const sw = this.create("span", "sc-ep-colorbtn-sw");
    const txt = this.create("span", "sc-ep-colorbtn-txt");
    btn.append(sw, txt);
    this.colorBtns.set(property, btn);
    this.on(btn, "click", () => this.openColorPicker(property));
    row.append(lab, btn);
    this.initializers.push(() => this.refreshColorButton(property));
    return row;
  }

  /** The element's current computed value for a color property, as a CSS string. */
  private currentColorCss(property: string): string {
    const c = readComputedColor(this.el, property, this.colorProbe);
    if (c) return rgbaToCss(c);
    return readComputedValue(this.el, property) ?? "#000000";
  }

  /** Reflect the element's current color onto its picker button (swatch + label). */
  private refreshColorButton(property: string): void {
    const btn = this.colorBtns.get(property);
    if (!btn) return;
    const sw = btn.querySelector?.(".sc-ep-colorbtn-sw") as HTMLElement | null;
    const txt = btn.querySelector?.(".sc-ep-colorbtn-txt") as HTMLElement | null;
    const c = readComputedColor(this.el, property, this.colorProbe);
    if (c && isTransparent(c)) {
      if (sw) sw.style.background = "transparent";
      if (txt) txt.textContent = "Transparent";
    } else if (c) {
      if (sw) sw.style.background = rgbaToCss(c);
      if (txt) txt.textContent = c.a >= 1 ? rgbaToHex6(c) : rgbaToHex8(c);
    } else if (txt) {
      txt.textContent = "Default";
    }
  }

  /** Open the alpha-capable color picker for a color property (U10). */
  private openColorPicker(property: string): void {
    if (this.activeColorPicker) {
      this.activeColorPicker.close();
      return;
    }
    const picker = new ColorPicker({
      doc: this.doc,
      container: this.root,
      create: (tag, cls) => this.create(tag, cls),
      probe: this.colorProbe,
      initial: this.currentColorCss(property),
      palette: extractPalette(this.doc, { probe: this.colorProbe }),
      recents: this.cb.colorRecents?.() ?? [],
      matchToken: (css) => this.matchColorToken(css),
      onChange: (css, valueToken) => {
        this.recordStyle(property, css, valueToken ? { valueToken } : {});
        this.refreshColorButton(property);
      },
      onClose: () => {
        this.activeColorPicker = null;
        this.colorBtns.get(property)?.focus?.();
      },
      onPicked: (hex8) => this.cb.onColorPicked?.(hex8),
      registerEscape: this.cb.registerEscapeLayer,
    });
    this.activeColorPicker = picker;
    picker.open();
  }

  /** The standalone element-opacity control (U10: moved out of the Colour section). */
  private opacityRow(): HTMLElement {
    const row = this.create("div", "sc-ep-row");
    const lab = this.create("label", "sc-ep-label");
    lab.textContent = "Opacity";
    const opacity = this.create("input", "sc-ep-number sc-ep-opacity sc-ep-ctl-opacity") as HTMLInputElement;
    opacity.type = "number";
    opacity.setAttribute("aria-label", "Opacity (%)");
    const opacityWrap = this.create("div", "sc-ep-opacity-wrap");
    const pct = this.create("span", "sc-ep-opacity-pct");
    pct.textContent = "%";
    opacityWrap.append(opacity, pct);
    this.on(opacity, "input", () => {
      const raw = opacity.value.trim();
      if (raw === "") return;
      const pctNum = Math.max(0, Math.min(100, Number(raw)));
      this.recordStyle("opacity", String(pctNum / 100));
    });
    row.append(lab, opacityWrap);
    this.initializers.push(() => {
      const op = readComputedValue(this.el, "opacity");
      const opNum = op == null ? 1 : parseFloat(op);
      opacity.value = Number.isFinite(opNum) ? String(Math.round(opNum * 100)) : "100";
    });
    return row;
  }

  // --- Effects (radius / border / shadow) — R13/U18 ------------------------

  private buildEffectsSection(): void {
    const body = this.section("Effects");

    // U10: element opacity is its OWN control (distinct from a color's alpha),
    // and applies to any element, so it lives here rather than in Colour.
    body.appendChild(this.opacityRow());

    // Border radius: uniform, plus an expand-to-per-corner mode.
    body.appendChild(this.numberRow("Radius", "border-radius", { unit: "px" }));
    const corners = this.create("div", "sc-ep-corners");
    corners.setAttribute("data-open", "0");
    for (const [label, prop] of [
      ["Top left", "border-top-left-radius"],
      ["Top right", "border-top-right-radius"],
      ["Bottom right", "border-bottom-right-radius"],
      ["Bottom left", "border-bottom-left-radius"],
    ] as const) {
      corners.appendChild(this.numberRow(label, prop, { unit: "px" }));
    }
    const toggle = this.button("sc-ep-corners-toggle", "Per corner", () => {
      const open = corners.getAttribute("data-open") === "1";
      corners.setAttribute("data-open", open ? "0" : "1");
      toggle.setAttribute("aria-pressed", String(!open));
    });
    toggle.setAttribute("aria-pressed", "false");
    body.append(toggle, corners);

    // Border: width + style + colour (the picker arrives in U10).
    body.appendChild(this.numberRow("Border width", "border-width", { unit: "px" }));
    body.appendChild(
      this.selectRow("Border style", "border-style", [
        { label: "None", value: "none" },
        { label: "Solid", value: "solid" },
        { label: "Dashed", value: "dashed" },
        { label: "Dotted", value: "dotted" },
      ]),
    );
    body.appendChild(this.colorRow("Border colour", "border-color"));

    // Box shadow presets (custom offset/blur/spread + colour lands with U10).
    body.appendChild(
      this.selectRow("Shadow", "box-shadow", [
        { label: "None", value: "none" },
        { label: "Small", value: "0 1px 2px rgba(0, 0, 0, 0.12)" },
        { label: "Medium", value: "0 4px 12px rgba(0, 0, 0, 0.15)" },
        { label: "Large", value: "0 12px 32px rgba(0, 0, 0, 0.22)" },
        { label: "Inset", value: "inset 0 2px 6px rgba(0, 0, 0, 0.18)" },
      ]),
    );
  }

  /** Border color (U18) — now the U10 alpha-capable picker, like the Colour section. */
  private colorRow(label: string, property: string): HTMLElement {
    return this.colorButtonRow(label, property);
  }

  // --- Image (replace / fit / radius) — R6 ---------------------------------

  private buildImageSection(): void {
    const body = this.section("Image");

    // Replace via URL (https + public host; cross-origin is record-intent-only).
    const urlRow = this.create("div", "sc-ep-row sc-ep-image-url");
    const urlInput = this.create("input", "sc-ep-hex sc-ep-ctl-image-url") as HTMLInputElement;
    urlInput.type = "url";
    urlInput.placeholder = "https://…";
    urlInput.setAttribute("aria-label", "Replace image URL");
    const applyBtn = this.button("sc-ep-btn sc-ep-image-apply", "Replace", () =>
      this.recordSwapUrl(urlInput.value),
    );
    urlRow.append(urlInput, applyBtn);
    body.appendChild(urlRow);

    // Replace via file upload (bytes ride the reference-image channel to the agent).
    const fileRow = this.create("div", "sc-ep-row sc-ep-image-file");
    const fileLabel = this.create("label", "sc-ep-label");
    fileLabel.textContent = "Upload";
    const file = this.create("input", "sc-ep-file sc-ep-ctl-image-file") as HTMLInputElement;
    file.type = "file";
    file.setAttribute("accept", "image/*");
    file.setAttribute("aria-label", "Replace image file");
    this.on(file, "change", () => this.recordSwapFile(file));
    fileRow.append(fileLabel, file);
    body.appendChild(fileRow);

    body.appendChild(
      this.selectRow("Fit", "object-fit", [
        { label: "Cover", value: "cover" },
        { label: "Contain", value: "contain" },
        { label: "Fill", value: "fill" },
        { label: "None", value: "none" },
        { label: "Scale down", value: "scale-down" },
      ]),
    );
    // (Border radius lives in the shared Effects section — R13/U18.)
  }

  private recordSwapUrl(raw: string): void {
    const verdict = classifySwapUrl(raw, this.cb.pageOrigin?.());
    if (!verdict.ok) {
      this.markDegraded("image-url", true); // invalid / unsafe → flag, record nothing
      return;
    }
    this.markDegraded("image-url", false);
    this.recordSwap(raw.trim());
  }

  private recordSwapFile(input: HTMLInputElement): void {
    const file = (input.files as FileList | null)?.[0];
    if (!file) return;
    const view = this.doc.defaultView as {
      URL?: { createObjectURL?: (f: unknown) => string };
      FileReader?: new () => {
        result: unknown;
        onload: (() => void) | null;
        readAsDataURL(f: unknown): void;
      };
    } | null;
    // Deliver the actual bytes to the agent as a signed reference (existing
    // channel); the recorded op stays record-intent-only for other viewers.
    try {
      const reader = view?.FileReader ? new view.FileReader() : null;
      if (reader) {
        reader.onload = () => this.cb.onSwapImageFile?.(String(reader.result ?? ""));
        reader.readAsDataURL(file);
      }
    } catch {
      /* best-effort delivery */
    }
    const objectUrl = view?.URL?.createObjectURL?.(file);
    if (objectUrl) this.recordSwap(objectUrl); // blob: preview → record-intent-only
  }

  private recordSwap(newSrc: string): void {
    const before = this.el.getAttribute?.("src") ?? null;
    // Preview now (neutralizing srcset/sizes + <picture> sources for an exact
    // restore); the engine keeps the FIRST restore as the build baseline.
    const preview = previewSwapMedia(this.el, newSrc);
    const dom: EditDom = {
      apply: () => {
        previewSwapMedia(this.el, newSrc);
      },
      invert: () => preview.restore(),
      revertToBuild: () => preview.restore(),
    };
    this.cb.record(buildSwapMediaOp(this.target, before, newSrc), dom);
    this.refreshCount();
  }

  // --- Visibility (hide — R13) ---------------------------------------------

  private buildVisibilitySection(): void {
    const body = this.section("Visibility");
    body.appendChild(
      this.button("sc-ep-btn sc-ep-hide", "Hide element", () => this.recordHide()),
    );
  }

  private recordHide(): void {
    const op = buildSetVisibilityOp(this.target, true);
    // Ghost the vacated slot (U4) using the rect captured BEFORE the element
    // collapses to display:none.
    this.cb.onElementHidden?.(this.rectOf());
    const priorDisplay = previewHide(this.el); // apply now (author clicked)
    const dom: EditDom = {
      apply: () => {
        previewHide(this.el);
      },
      invert: () => previewShow(this.el, priorDisplay),
      revertToBuild: () => previewShow(this.el, priorDisplay),
    };
    this.cb.record(op, dom);
    this.refreshCount();
  }

  /** The element's current viewport rect (best-effort; zeros without a real DOM). */
  private rectOf(): { x: number; y: number; width: number; height: number } {
    try {
      const r = this.el.getBoundingClientRect?.();
      if (r) return { x: r.x ?? r.left ?? 0, y: r.y ?? r.top ?? 0, width: r.width ?? 0, height: r.height ?? 0 };
    } catch {
      /* best-effort */
    }
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // --- Arrange (functional reorder, requirement F) -------------------------

  private buildArrangeSection(): void {
    const parent = this.el.parentElement;
    const siblings = parent ? Array.from(parent.children) : [];
    if (siblings.length < 2) return; // nothing to reorder → contextual hide

    const body = this.section("Arrange");
    const actions = this.create("div", "sc-ep-arrange");
    // Orientation-correct buttons: rows read left/right, columns up/down, grids
    // both axes, RTL flipped (R5). Each maps to a DOM-order step.
    const ctx = layoutContextFor(this.el);
    actions.setAttribute("data-axis", ctx.axis);
    for (const b of ctx.buttons) {
      const btn = this.button(`sc-ep-btn sc-ep-move-${b.word}`, b.label, () => this.move(b.dir));
      actions.appendChild(btn);
    }
    body.appendChild(actions);
  }

  /**
   * Reorder among siblings (requirement F): actually move the node in the DOM so
   * the reviewer SEES it, and record a well-anchored `moveNode` carrying the
   * parent, the moved element, AND the reference-neighbour + before/after — so
   * the agent can act on "move X before/after Y". The move is ephemeral; the
   * revert restores the exact original position.
   */
  private move(direction: -1 | 1): void {
    const parent = this.el.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children);
    const from = siblings.indexOf(this.el);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= siblings.length) return; // no-op at the edges
    const neighbour = siblings[to] ?? null;
    const position: "before" | "after" = direction < 0 ? "before" : "after";
    const insertion: InsertionPoint = {
      parent: buildEditTarget(parent, this.doc),
      reference: neighbour ? buildEditTarget(neighbour, this.doc) : undefined,
      position,
    };
    const revert = previewMove(this.el, neighbour, position);
    // Redo re-runs the move; undo AND revert-to-build restore the prior position
    // (the engine keeps the first move's revert as the build baseline, so a
    // coalesced sequence still nets back to the true original slot).
    const dom: EditDom = {
      apply: () => {
        previewMove(this.el, neighbour, position);
      },
      invert: revert,
      revertToBuild: revert,
    };
    this.cb.record(buildMoveOp(this.target, insertion, from, to), dom);
    this.refreshCount();
  }

  // --- Footer --------------------------------------------------------------

  private buildFooter(): void {
    const footer = this.create("div", "sc-ep-footer");

    // U5 (R1-R3/R6): a workspace MEMBER session gets a private prompt field for
    // the coding agent, rendered where "Send to agent" lives — independent of
    // canSendToAgent (member-only gating, not also grant-gating: a member
    // without the send grant can still author a prompt for someone else to
    // send later from the dashboard). A guest session never sees this at all.
    if (this.cb.isMember) {
      const promptWrap = this.create("div", "sc-ep-prompt-wrap");
      const label = this.create("label", "sc-ep-prompt-label");
      label.textContent = "Prompt for agent";
      const field = this.create("textarea", "sc-ep-prompt") as HTMLTextAreaElement;
      field.setAttribute("aria-label", "Prompt for agent");
      field.placeholder = "Optional instructions for the coding agent";
      field.value = this.cb.getPromptText?.() ?? "";
      this.on(field, "input", () => this.cb.onPromptChange?.(field.value));
      promptWrap.append(label, field);
      footer.appendChild(promptWrap);
    }

    // The counter is a button that opens the session review list (R17).
    this.countEl = this.button("sc-ep-count", "0 edits", () => this.toggleEditsList());
    this.countEl.setAttribute("aria-haspopup", "true");
    this.countEl.setAttribute("aria-expanded", "false");
    this.undoBtn = this.button("sc-ep-undo", "Undo", () => {
      this.cb.undo();
      this.resync();
    });
    this.redoBtn = this.button("sc-ep-redo", "Redo", () => {
      this.cb.redo?.();
      this.resync();
    });
    this.saveBtn = this.button("sc-ep-save", "Save comment", () => this.cb.onSave());
    footer.append(this.countEl, this.undoBtn, this.redoBtn, this.saveBtn);
    // Phase 2: permitted member sessions also get "Send to agent" (save + enqueue),
    // ALONGSIDE "Save comment". Guests / non-permitted members never see it.
    if (this.cb.canSendToAgent && this.cb.onSendToAgent) {
      this.sendBtn = this.button("sc-ep-send", "Send to agent", () =>
        this.cb.onSendToAgent!(),
      );
      footer.append(this.sendBtn);
    }
    this.root.appendChild(footer);
  }

  // --- Recording -----------------------------------------------------------

  /** U14: the responsive tag for the current surface, or undefined at base ("web"). */
  private surfaceTag(): DeviceSurface | undefined {
    const s = this.cb.surface;
    return s && s !== "web" ? s : undefined;
  }

  private recordStyle(property: string, after: string, opts: { valueToken?: string } = {}): void {
    const before = this.beforeFor(property);
    const revertToBuild = this.revertFor(property); // first-write-wins build snapshot
    const prevSnap = readInlineSnapshot(this.el, property); // state before THIS write
    // Verified apply (U2): write, read back through the U1 pipeline, escalate to
    // !important only if site CSS wins; the op records the clean value and flags
    // previewUnavailable when even the escalation loses.
    const { previewUnavailable } = applyStyleVerified(this.el, property, after, {
      probe: this.colorProbe,
      direction: this.dirCtx().direction,
    });
    const nextSnap = readInlineSnapshot(this.el, property); // state after THIS write
    const dom: EditDom = {
      apply: () => restoreInlineSnapshot(this.el, property, nextSnap),
      invert: () => restoreInlineSnapshot(this.el, property, prevSnap),
      revertToBuild,
    };
    this.cb.record(
      buildStyleOp({
        target: this.target,
        property,
        before,
        after,
        previewUnavailable,
        ...(opts.valueToken ? { valueToken: opts.valueToken } : {}),
        ...(this.surfaceTag() ? { responsive: this.surfaceTag() } : {}),
      }),
      dom,
    );
    this.markDegraded(property, previewUnavailable);
    this.refreshCount();
  }

  // --- Design tokens (U11) --------------------------------------------------

  /** The page's custom-property index, built lazily on first color pick. */
  private tokenIndex: TokenDecl[] | null = null;

  /** Match a color value to a page design token resolved ON this element, or null. */
  private matchColorToken(css: string): string | null {
    this.tokenIndex ??= buildTokenIndex(this.doc);
    if (this.tokenIndex.length === 0) return null;
    return matchToken(this.tokenIndex, css, {
      normalize: (v) => canonicalColor(v, this.colorProbe),
      resolveOnElement: (name) => this.resolveCustomProp(name),
    });
  }

  /** The element-scoped resolved value of a custom property (theme-correct). */
  private resolveCustomProp(name: string): string {
    try {
      const win = this.doc.defaultView as
        | { getComputedStyle?: (e: Element) => { getPropertyValue?: (p: string) => string } }
        | undefined;
      return win?.getComputedStyle?.(this.el)?.getPropertyValue?.(name)?.trim() ?? "";
    } catch {
      return "";
    }
  }

  /**
   * Toggle an in-control degradation badge when a preview could not be verified
   * (U2) — a first-class UI signal, not agent-only. Reused by U8's font picker.
   */
  private markDegraded(property: string, unavailable: boolean): void {
    const ctl = this.root.querySelector?.(`.sc-ep-ctl-${property}`) as HTMLElement | null;
    if (!ctl) return;
    const row = (ctl.closest?.(".sc-ep-row") as HTMLElement | null) ?? ctl;
    if (unavailable) {
      row.setAttribute?.("data-sc-degraded", "1");
      if (!row.querySelector?.(".sc-ep-degraded")) {
        const badge = this.create("span", "sc-ep-degraded");
        badge.setAttribute("role", "img");
        badge.setAttribute("aria-label", "Preview unavailable on this page");
        badge.title =
          "Preview unavailable on this page; the value is still recorded for the agent.";
        badge.textContent = "⚠";
        row.appendChild(badge);
      }
    } else {
      row.removeAttribute?.("data-sc-degraded");
      (row.querySelector?.(".sc-ep-degraded") as HTMLElement | null)?.remove?.();
    }
  }

  // --- Font family (U8) ----------------------------------------------------

  /** The "Font" row: a button showing the current family that opens the picker. */
  private fontRow(): HTMLElement {
    const row = this.create("div", "sc-ep-row");
    const lab = this.create("label", "sc-ep-label");
    lab.textContent = "Font";
    const btn = this.create("button", "sc-ep-fontbtn sc-ep-ctl-font-family") as HTMLButtonElement;
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "listbox");
    this.fontBtn = btn;
    this.on(btn, "click", () => this.openFontPicker());
    row.append(lab, btn);
    this.initializers.push(() => {
      btn.textContent = this.currentFontLabel();
    });
    return row;
  }

  /** The element's current primary font family, normalized for display. */
  private currentFontLabel(): string {
    const raw = firstFamilyToken(readComputedValue(this.el, "font-family"));
    return raw ? normalizeFamilyName(raw) : "Default";
  }

  /** Open the font picker anchored to the panel (one instance at a time). */
  private openFontPicker(): void {
    if (this.activePicker) {
      this.activePicker.close();
      return;
    }
    const picker = new FontPicker({
      doc: this.doc,
      container: this.root,
      create: (tag, cls) => this.create(tag, cls),
      pageFonts: detectPageFonts(this.doc),
      env: this.cb.fontEnv ?? null,
      recents: this.cb.fontRecents?.() ?? [],
      currentFamily: this.currentFontLabel(),
      onSelect: (sel) => this.applyFontSelection(sel),
      onClose: () => {
        this.activePicker = null;
        this.fontBtn?.focus?.();
      },
      registerEscape: this.cb.registerEscapeLayer,
      uploadCount: this.cb.fontUploadCount,
    });
    this.activePicker = picker;
    void picker.open();
  }

  /** Record a picked font, refresh the button label, and adapt the weight options. */
  private applyFontSelection(sel: FontSelection): void {
    const op = this.recordFontFamily(sel);
    // U9: hand the uploaded font's bytes to the controller for save-time upload,
    // keyed by the op just recorded (its fileRef fills in at save).
    if (sel.source === "upload" && sel.upload && op) {
      this.cb.onFontFileUpload?.(op.opId, sel.upload);
    }
    if (this.fontBtn) this.fontBtn.textContent = sel.family;
    this.adaptWeightOptions(sel.weights);
    this.cb.onFontPicked?.(sel.family);
  }

  /**
   * Record a `font-family` op carrying the U7 font identity (family + provenance +
   * weights). Mirrors {@link recordStyle}'s verified-apply + exact-revert, adding
   * the identity for a concrete family (a generic keyword records no identity).
   */
  private recordFontFamily(sel: FontSelection): ChangeOp {
    const property = "font-family";
    const before = this.beforeFor(property);
    const revertToBuild = this.revertFor(property);
    const prevSnap = readInlineSnapshot(this.el, property);
    const { previewUnavailable } = applyStyleVerified(this.el, property, sel.css, {
      probe: this.colorProbe,
      direction: this.dirCtx().direction,
    });
    const nextSnap = readInlineSnapshot(this.el, property);
    const dom: EditDom = {
      apply: () => restoreInlineSnapshot(this.el, property, nextSnap),
      invert: () => restoreInlineSnapshot(this.el, property, prevSnap),
      revertToBuild,
    };
    // The preview is unavailable if the write itself lost OR the Google face never
    // loaded — either way the agent trusts the recorded family over the raster. An
    // uploaded font's fileRef fills in at SAVE; if that upload fails the controller
    // marks the op previewUnavailable then (never a dangling ref).
    const pu = previewUnavailable || sel.loadResult?.previewUnavailable === true;
    const font =
      sel.source === "generic"
        ? undefined
        : {
            family: sel.family,
            source: sel.source,
            ...(sel.weights.length ? { weights: sel.weights } : {}),
            ...(sel.rawStack ? { rawStack: sel.rawStack } : {}),
          };
    const op = buildStyleOp({
      target: this.target,
      property,
      before,
      after: sel.css,
      previewUnavailable: pu,
      font,
      ...(this.surfaceTag() ? { responsive: this.surfaceTag() } : {}),
    });
    this.cb.record(op, dom);
    this.markDegraded(property, pu);
    this.refreshCount();
    return op;
  }

  /** Repopulate the Weight control with a family's real weights, keeping the value. */
  private adaptWeightOptions(weights: string[]): void {
    if (weights.length === 0) return;
    const select = this.root.querySelector?.(".sc-ep-ctl-font-weight") as HTMLSelectElement | null;
    if (!select) return;
    const current = select.value;
    select.replaceChildren?.();
    for (const w of weights) {
      const o = this.create("option") as HTMLOptionElement;
      o.value = w;
      o.textContent = weightLabel(w);
      select.appendChild(o);
    }
    select.value = weights.includes(current) ? current : (weights[0] ?? "400");
  }

  /** The developer-build computed value for a property (the op `before`), captured once. */
  private beforeFor(property: string): string | null {
    if (!this.originalComputed.has(property)) {
      this.originalComputed.set(property, readComputedValue(this.el, property));
    }
    return this.originalComputed.get(property) ?? null;
  }

  /**
   * A revert closure that restores the property's ORIGINAL inline declaration —
   * value AND `!important` priority — captured ONCE, before any preview, so a
   * repeated nudge still reverts all the way to the developer's build byte-
   * identical (U2/R3: undo must not silently strip a pre-existing !important).
   */
  private revertFor(property: string): () => void {
    let revert = this.styleReverts.get(property);
    if (!revert) {
      const snap: InlineSnapshot = readInlineSnapshot(this.el, property);
      revert = () => restoreInlineSnapshot(this.el, property, snap);
      this.styleReverts.set(property, revert);
    }
    return revert;
  }

  // --- Control builders ----------------------------------------------------

  private numberRow(
    label: string,
    property: string,
    opts: { unit?: string; step?: number; allowNegative?: boolean; ensureFlex?: boolean } = {},
  ): HTMLElement {
    const row = this.create("div", "sc-ep-row");
    const lab = this.create("label", "sc-ep-label");
    lab.textContent = label;

    const wrap = this.create("div", "sc-ep-num");
    const input = this.create("input", `sc-ep-number sc-ep-ctl-${property}`) as HTMLInputElement;
    input.type = "number";
    input.setAttribute("aria-label", label);
    // The registry supplies unit / step / range so the read and write sides agree
    // (line-height writes px, not a unitless multiplier); explicit opts still win.
    const meta = getPropertyMeta(property);
    const unit = opts.unit ?? meta.unit;
    const step = opts.step ?? meta.step;
    const allowNegative = opts.allowNegative ?? meta.allowNegative;
    const commit = (raw: string): void => {
      if (raw.trim() === "") return;
      if (opts.ensureFlex) this.ensureDisplayFlex();
      this.recordStyle(property, `${raw}${unit}`);
    };
    this.on(input, "input", () => commit(input.value));
    const stepper = this.stepper(
      () => this.bump(input, step, allowNegative, commit),
      () => this.bump(input, -step, allowNegative, commit),
    );
    wrap.append(input, stepper);
    row.append(lab, wrap);

    this.initializers.push(() => {
      input.value = meta.displayFrom(readComputedValue(this.el, property), this.dirCtx());
    });
    return row;
  }

  private selectRow(
    label: string,
    property: string,
    options: Array<{ label: string; value: string }>,
    opts: { ensureFlex?: boolean } = {},
  ): HTMLElement {
    const row = this.create("div", "sc-ep-row");
    const lab = this.create("label", "sc-ep-label");
    lab.textContent = label;
    const select = this.create("select", `sc-ep-select sc-ep-ctl-${property}`) as HTMLSelectElement;
    for (const opt of options) {
      const o = this.create("option") as HTMLOptionElement;
      o.value = opt.value;
      o.textContent = opt.label;
      select.appendChild(o);
    }
    this.on(select, "change", () => {
      if (opts.ensureFlex) this.ensureDisplayFlex();
      this.recordStyle(property, select.value);
    });
    row.append(lab, select);
    const meta = getPropertyMeta(property);
    this.initializers.push(() => {
      const computed = readComputedValue(this.el, property);
      const ctx = this.dirCtx();
      const match = options.find((o) => meta.matchesOption(o.value, computed, ctx));
      if (match) select.value = match.value;
    });
    return row;
  }

  private segmentedRow(
    label: string,
    property: string,
    options: Array<{ label: string; value: string }>,
    opts: { wide?: boolean; ensureFlex?: boolean } = {},
  ): HTMLElement {
    const row = this.create("div", `sc-ep-row ${opts.wide ? "sc-ep-row-stack" : ""}`);
    const lab = this.create("label", "sc-ep-label");
    lab.textContent = label;
    const seg = this.create("div", `sc-ep-segmented sc-ep-ctl-${property}`);
    const buttons: Array<{ btn: HTMLButtonElement; value: string }> = [];
    for (const opt of options) {
      const btn = this.segButton(opt.label, () => {
        if (opts.ensureFlex) this.ensureDisplayFlex();
        this.recordStyle(property, opt.value);
        for (const b of buttons) b.btn.setAttribute("aria-pressed", String(b.value === opt.value));
      });
      buttons.push({ btn, value: opt.value });
      seg.appendChild(btn);
    }
    row.append(lab, seg);
    const meta = getPropertyMeta(property);
    this.initializers.push(() => {
      const computed = readComputedValue(this.el, property);
      const ctx = this.dirCtx();
      for (const b of buttons) {
        b.btn.setAttribute("aria-pressed", String(meta.matchesOption(b.value, computed, ctx)));
      }
    });
    return row;
  }

  /** A single segmented-control button. */
  private segButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = this.doc.createElement("button") as HTMLButtonElement;
    btn.type = "button";
    btn.className = "sc-ep-seg";
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = label;
    this.on(btn, "click", onClick);
    return btn;
  }

  /** An up/down stepper (two chevron buttons). */
  private stepper(onUp: () => void, onDown: () => void): HTMLElement {
    const wrap = this.create("div", "sc-ep-stepper");
    const up = this.doc.createElement("button") as HTMLButtonElement;
    up.type = "button";
    up.className = "sc-ep-step sc-ep-step-up";
    up.setAttribute("aria-label", "Increase");
    up.textContent = "▲";
    const down = this.doc.createElement("button") as HTMLButtonElement;
    down.type = "button";
    down.className = "sc-ep-step sc-ep-step-down";
    down.setAttribute("aria-label", "Decrease");
    down.textContent = "▼";
    this.on(up, "click", onUp);
    this.on(down, "click", onDown);
    wrap.append(up, down);
    return wrap;
  }

  /** Nudge a number input by `delta` and commit the new value. */
  private bump(
    input: HTMLInputElement,
    delta: number,
    allowNegative: boolean,
    commit: (raw: string) => void,
  ): void {
    const current = parseFloat(input.value);
    let next = (Number.isFinite(current) ? current : 0) + delta;
    if (!allowNegative && next < 0) next = 0;
    // Trim floating error from fractional steps (e.g. line-height 1.1000000001).
    const rounded = Math.round(next * 1000) / 1000;
    input.value = String(rounded);
    commit(input.value);
  }

  /**
   * A layout edit (align/justify/gap/direction) implies the element is a flex
   * container. Record `display: flex` too so the change-set is coherent; when the
   * element is already flex this coalesces to a net no-op and leaves no trace.
   */
  private ensureDisplayFlex(): void {
    // Never convert a grid container to flex (R2) — align/justify are valid on a
    // grid as-is; only a non-flex, non-grid element needs display:flex recorded.
    if (!layoutEditImpliesFlex(readComputedValue(this.el, "display"))) return;
    this.recordStyle("display", "flex");
  }

  // --- Helpers -------------------------------------------------------------

  /** Registry context: the element's writing direction + the shared colour probe. */
  private dirCtx(): PropCtx {
    const dir = readComputedValue(this.el, "direction");
    return { direction: dir === "rtl" ? "rtl" : "ltr", probe: this.colorProbe };
  }

  /** Read a computed value as a bare number string ("48px" → "48"), or "". */
  private readNumber(property: string): string {
    const v = readComputedValue(this.el, property);
    if (v == null) return "";
    const n = parseFloat(v);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "";
  }

  private refreshCount(): void {
    const n = this.cb.count();
    this.countEl.textContent = n === 1 ? "1 edit" : `${n} edits`;
    this.saveBtn.disabled = n === 0;
    // Undo/redo track the history engine's real state (redo survives after undo,
    // even when the net edit count is 0), falling back to the count when a
    // caller does not expose canUndo/canRedo (e.g. the panel unit-test mock).
    this.undoBtn.disabled = this.cb.canUndo ? !this.cb.canUndo() : n === 0;
    this.redoBtn.disabled = this.cb.canRedo ? !this.cb.canRedo() : true;
    if (this.sendBtn) this.sendBtn.disabled = n === 0;
    if (this.editsListOpen) this.renderEditsList();
  }

  /** Re-read every control from the live DOM and refresh the footer (post undo/redo). */
  resync(): void {
    this.syncControls();
    this.refreshCount();
  }

  /**
   * U12: record a committed drag-resize (explicit px width + height) as ONE undo
   * step. The inspector owns the live gesture + preview and restores the
   * pre-gesture inline before calling this, so recordStyle re-applies from the
   * developer build; the gesture wrapper coalesces both records into one step.
   */
  applyResize(width: number, height: number): void {
    this.cb.beginGesture?.();
    this.recordStyle("width", `${width}px`);
    this.recordStyle("height", `${height}px`);
    this.cb.commitGesture?.();
    this.syncControls();
  }

  /**
   * U13: record a committed drag-reorder as a `moveNode` (the same anchored op the
   * Arrange buttons produce). The inspector resolves the drop slot to a reference
   * sibling + before/after + true DOM indices; this moves the node in the DOM
   * (ephemeral preview) and records the intent, no-op-guarded so a drop where the
   * element already sits records nothing.
   */
  applyReorder(c: {
    from: number;
    to: number;
    referenceIndex: number;
    position: "before" | "after";
  }): void {
    const parent = this.el.parentElement;
    if (!parent) return;
    const reference = parent.children[c.referenceIndex] ?? null;
    if (!reference || reference === this.el || c.referenceIndex === c.from) return;
    // Already adjacent on the requested side (true-index) → no move to record.
    if (c.position === "before" && c.referenceIndex === c.from + 1) return;
    if (c.position === "after" && c.referenceIndex === c.from - 1) return;
    const insertion: InsertionPoint = {
      parent: buildEditTarget(parent, this.doc),
      reference: buildEditTarget(reference, this.doc),
      position: c.position,
    };
    const revert = previewMove(this.el, reference, c.position);
    const dom: EditDom = {
      apply: () => {
        previewMove(this.el, reference, c.position);
      },
      invert: revert,
      revertToBuild: revert,
    };
    this.cb.record(buildMoveOp(this.target, insertion, c.from, c.to), dom);
    this.refreshCount();
  }

  /**
   * Refresh only the footer counter, undo/redo state, and open review list — NOT
   * the control inputs — so a history event (e.g. a keyboard undo elsewhere) never
   * clobbers a value the reviewer is actively typing. Driven by the controller's
   * history subscription (U3).
   */
  refreshUi(): void {
    this.refreshCount();
  }

  // --- Session review list (R17) -------------------------------------------

  private toggleEditsList(): void {
    this.editsListOpen = !this.editsListOpen;
    this.countEl.setAttribute("aria-expanded", String(this.editsListOpen));
    if (this.editsListOpen) {
      this.renderEditsList();
      // Focus moves into the first operable control on open (finding: popover focus).
      const first = this.editsListEl?.querySelector?.(
        ".sc-ep-edit-revert, .sc-ep-edits-discard",
      ) as HTMLElement | null;
      first?.focus?.();
    } else {
      this.closeEditsList();
    }
  }

  /** Close the review list and return focus to the counter trigger. */
  closeEditsList(): void {
    if (!this.editsListOpen && !this.editsListEl) return;
    this.editsListOpen = false;
    this.countEl.setAttribute("aria-expanded", "false");
    this.editsListEl?.remove();
    this.editsListEl = null;
    this.countEl.focus?.();
  }

  private renderEditsList(): void {
    if (!this.editsListEl) {
      this.editsListEl = this.create("div", "sc-ep-edits");
      this.editsListEl.setAttribute("role", "list");
      this.editsListEl.setAttribute("aria-label", "Edits this session");
      this.root.appendChild(this.editsListEl);
    }
    this.editsListEl.replaceChildren?.();
    const rows = this.cb.entries?.() ?? [];
    for (const row of rows) {
      const rowEl = this.create("div", "sc-ep-edit-row");
      rowEl.setAttribute("role", "listitem");
      const label = this.create("span", "sc-ep-edit-label");
      label.textContent = row.label;
      const revert = this.button("sc-ep-edit-revert", "Revert", () => {
        this.cb.revertEdit?.(row.key);
        this.resync();
      });
      revert.setAttribute("aria-label", `Revert ${row.label}`);
      rowEl.append(label, revert);
      this.editsListEl.appendChild(rowEl);
    }
    if (rows.length === 0) {
      const empty = this.create("div", "sc-ep-edits-empty");
      empty.textContent = "No edits yet";
      this.editsListEl.appendChild(empty);
    } else {
      const discard = this.button("sc-ep-edits-discard", "Discard all", () => {
        this.cb.discard();
        this.resync();
      });
      this.editsListEl.appendChild(discard);
    }
  }

  private section(title: string): HTMLElement {
    const section = this.create("div", "sc-ep-section");
    const header = this.create("div", "sc-ep-section-head");
    const heading = this.create("div", "sc-ep-section-title");
    heading.textContent = title;
    const collapse = this.button("sc-ep-collapse", "–", () => {
      const collapsed = section.getAttribute("data-collapsed") === "1";
      section.setAttribute("data-collapsed", collapsed ? "0" : "1");
      collapse.textContent = collapsed ? "–" : "+";
    });
    collapse.setAttribute("aria-label", `Toggle ${title}`);
    header.append(heading, collapse);
    const body = this.create("div", "sc-ep-section-body");
    section.append(header, body);
    this.root.appendChild(section);
    return body;
  }

  /** Drag the panel by its header handle (real-env; a no-op without pointer events). */
  private enableDrag(handle: HTMLElement): void {
    const onDown = (e: unknown): void => {
      const me = e as MouseEvent;
      const startX = me.clientX;
      const startY = me.clientY;
      const rect = this.root.getBoundingClientRect?.();
      const baseLeft = rect ? rect.left : 0;
      const baseTop = rect ? rect.top : 0;
      me.preventDefault?.();
      const view = this.doc.defaultView;
      const onMove = (ev: unknown): void => {
        const m = ev as MouseEvent;
        this.root.style.left = `${baseLeft + (m.clientX - startX)}px`;
        this.root.style.top = `${baseTop + (m.clientY - startY)}px`;
        this.root.style.right = "auto";
      };
      const onUp = (): void => {
        view?.removeEventListener?.("mousemove", onMove as EventListener);
        view?.removeEventListener?.("mouseup", onUp as EventListener);
      };
      view?.addEventListener?.("mousemove", onMove as EventListener);
      view?.addEventListener?.("mouseup", onUp as EventListener);
    };
    this.on(handle, "mousedown", onDown);
  }

  private create(tag: string, className?: string): HTMLElement {
    const el = this.doc.createElement(tag);
    if (className) el.className = className.trim();
    return el;
  }

  private button(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = this.doc.createElement("button") as HTMLButtonElement;
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    this.on(btn, "click", onClick);
    return btn;
  }

  /** Register a listener and track its removal for {@link destroy}. */
  private on(target: Listenable, type: string, handler: (e: unknown) => void): void {
    const wrapped = (e: unknown): void => {
      try {
        handler(e);
      } catch {
        /* an edit control must never throw into the host page */
      }
    };
    target.addEventListener(type, wrapped);
    this.disposers.push(() => target.removeEventListener?.(type, wrapped));
  }
}

// ---------------------------------------------------------------------------
// Pure colour helpers (unit-tested).
// ---------------------------------------------------------------------------

/** Normalize user hex input to `#rrggbb` (accepts `#rgb`, missing `#`), or null. */
export function normalizeHex(input: string): string | null {
  const t = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(t)) {
    return `#${t.split("").map((c) => c + c).join("").toLowerCase()}`;
  }
  return null;
}

/** Convert a computed `rgb()/rgba()` (or hex) colour to `#rrggbb`, or null. */
export function rgbToHex(color: string | null): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  const asHex = normalizeHex(trimmed);
  if (asHex) return asHex;
  const m = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (!m || !m[1]) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  const [r, g, b] = parts;
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const hx = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hx(r as number)}${hx(g as number)}${hx(b as number)}`;
}
