/**
 * U9 — the visual-editor properties panel.
 *
 * A shadow-root inspector, bound to ONE selected element, that turns direct
 * manipulations into the semantic `ChangeOp`s of the U1 contract. It is the UI
 * layer over the already-built, unit-tested op-builders + ephemeral previews
 * (`style-edits.ts` / `structural-edits.ts`); it holds no durable state of its
 * own — every edit is `record()`ed into the controller's cross-element
 * {@link EditSession}, so switching elements or modes never loses work (G13/R7).
 *
 * What it records (the durable artifact) vs. what it previews (throwaway, a
 * framework re-render may revert it — G6):
 *  - Content:   inline text  → `setText`   + `applyTextPreview`   (leaf nodes only)
 *  - Style:     type/color/effects/spacing → `setStyle` + `applyStylePreview`
 *  - Structure: hide / delete / reorder / insert → `setVisibility`/`removeNode`/
 *               `moveNode`/`insertNode`, previewed via CSS only (never mutating
 *               framework-owned child lists — G12).
 *
 * `before` values are snapshotted from the developer's build the first time a
 * property is touched (before any preview is applied), so the change-set always
 * reflects "build → desired", and the EditSession drops a value that returns to
 * its original. Original / clean-room "quiet gallery" design; no third-party UI.
 * Every listener is tracked and removed in {@link destroy} (plans/008).
 */
import type { ChangeOp, EditTarget, InsertionPoint, NewNode } from "@supercomment/shared";

import {
  applyStylePreview,
  applyTextPreview,
  buildStyleOp,
  buildTextOp,
  readComputedValue,
  readText,
} from "./style-edits.js";
import {
  buildInsertOp,
  buildMoveOp,
  buildRemoveOp,
  buildSetVisibilityOp,
  previewHide,
  previewOrder,
  previewShow,
} from "./structural-edits.js";
import { buildEditTarget } from "./edit-target.js";

/** How the controller records/reverts edits into its durable EditSession. */
export interface PanelCallbacks {
  /** Record (or coalesce) one edit into the session. */
  record(op: ChangeOp): void;
  /** Remove a previously recorded edit (an explicit revert). */
  revert(op: ChangeOp): void;
  /** Throw away ALL in-progress edits (explicit discard, R7). */
  discard(): void;
  /** Current number of distinct edits, for the footer counter. */
  count(): number;
  /** The reviewer closed the panel (keeps the buffer; just dismisses the UI). */
  onClose(): void;
  /** Finalize the buffered edits as a template comment (opens the comment form). */
  onSave(): void;
}

/** A minimal listener target (both DOM `EventTarget`s and the test doubles). */
interface Listenable {
  addEventListener(type: string, handler: (e: unknown) => void): void;
  removeEventListener?(type: string, handler: (e: unknown) => void): void;
}

interface StyleControl {
  property: string;
  label: string;
  kind: "number" | "color" | "select";
  /** Appended to a numeric value, e.g. "px". */
  unit?: string;
  options?: Array<{ label: string; value: string }>;
}

/** The style properties the panel exposes (R2: typography, color, effects, spacing). */
const STYLE_CONTROLS: StyleControl[] = [
  { property: "font-size", label: "Font size", kind: "number", unit: "px" },
  {
    property: "font-weight",
    label: "Weight",
    kind: "select",
    options: [
      { label: "Normal", value: "400" },
      { label: "Medium", value: "500" },
      { label: "Semibold", value: "600" },
      { label: "Bold", value: "700" },
    ],
  },
  { property: "color", label: "Text color", kind: "color" },
  { property: "background-color", label: "Background", kind: "color" },
  { property: "border-radius", label: "Radius", kind: "number", unit: "px" },
  { property: "padding", label: "Padding", kind: "number", unit: "px" },
];

/** Tags offered by the "add element" control (semantic node, not raw HTML). */
const INSERT_TAGS = ["button", "p", "span", "div", "a", "h2"];

export class PropertiesPanel {
  private readonly root: HTMLElement;
  private readonly disposers: Array<() => void> = [];
  /** Original computed value per style property (snapshotted before any preview). */
  private readonly originals = new Map<string, string | null>();
  /** Ephemeral ghost nodes injected for insert previews (ours; safe to remove). */
  private readonly ghosts: Element[] = [];

  private countEl!: HTMLElement;
  private discardBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;
  private discardArmed = false;

  private originalText: string | null = null;

  private hidden = false;
  private priorDisplay: string | null = null;
  private hideBtn: HTMLButtonElement | null = null;

  private deleted = false;
  private removeOp: ChangeOp | null = null;
  private deleteBtn: HTMLButtonElement | null = null;

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
    private readonly el: Element,
    private readonly target: EditTarget,
    private readonly cb: PanelCallbacks,
  ) {
    this.root = doc.createElement("div");
    this.root.className = "sc-edit-panel";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Edit element");

    this.buildHeader();
    if (this.isTextLeaf()) this.buildContentSection();
    this.buildStyleSection();
    this.buildStructureSection();
    this.buildInsertSection();
    this.buildFooter();

    parent.appendChild(this.root);
    this.refreshCount();
  }

  /** Remove the panel + every listener it registered (plans/008). */
  destroy(): void {
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* teardown is best-effort */
      }
    }
    for (const ghost of this.ghosts.splice(0)) {
      try {
        ghost.remove();
      } catch {
        /* best-effort */
      }
    }
    this.root.remove();
  }

  // --- Sections ------------------------------------------------------------

  private buildHeader(): void {
    const header = this.create("div", "sc-ep-header");
    const title = this.create("div", "sc-ep-title");
    title.textContent = "Edit";
    const targetLabel = this.create("div", "sc-ep-target");
    targetLabel.textContent = describeElement(this.el);
    targetLabel.title = this.target.selector;
    const close = this.button("sc-ep-close", "×", () => this.cb.onClose());
    close.setAttribute("aria-label", "Close editor");
    const headings = this.create("div", "sc-ep-headings");
    headings.append(title, targetLabel);
    header.append(headings, close);
    this.root.appendChild(header);
  }

  private buildContentSection(): void {
    const section = this.section("Content");
    const row = this.create("div", "sc-ep-row sc-ep-row-stack");
    const label = this.create("label", "sc-ep-label");
    label.textContent = "Text";
    const input = this.create("textarea", "sc-ep-input sc-ep-textarea") as HTMLTextAreaElement;
    this.originalText = readText(this.el);
    input.value = this.originalText;
    this.on(input, "input", () => this.recordText(input.value));
    row.append(label, input);
    section.appendChild(row);
  }

  private buildStyleSection(): void {
    const section = this.section("Style");
    for (const control of STYLE_CONTROLS) {
      section.appendChild(this.styleRow(control));
    }
  }

  private styleRow(control: StyleControl): HTMLElement {
    const row = this.create("div", "sc-ep-row");
    const label = this.create("label", "sc-ep-label");
    label.textContent = control.label;

    // A per-property class (e.g. `sc-ep-ctl-font-size`) lets tests + callers
    // locate a specific control without an attribute selector.
    const ctl = `sc-ep-ctl-${control.property}`;

    let input: HTMLElement;
    if (control.kind === "select") {
      const select = this.create("select", `sc-ep-select ${ctl}`) as HTMLSelectElement;
      for (const opt of control.options ?? []) {
        const option = this.create("option") as HTMLOptionElement;
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
      }
      this.on(select, "change", () =>
        this.recordStyle(control, (select as HTMLSelectElement).value),
      );
      input = select;
    } else if (control.kind === "color") {
      const color = this.create("input", `sc-ep-color ${ctl}`) as HTMLInputElement;
      color.type = "color";
      this.on(color, "input", () =>
        this.recordStyle(control, (color as HTMLInputElement).value),
      );
      input = color;
    } else {
      const number = this.create("input", `sc-ep-number ${ctl}`) as HTMLInputElement;
      number.type = "number";
      number.placeholder = control.unit ?? "";
      this.on(number, "input", () => {
        const raw = (number as HTMLInputElement).value;
        if (raw.trim() === "") return; // cleared field records nothing
        this.recordStyle(control, `${raw}${control.unit ?? ""}`);
      });
      input = number;
    }
    input.setAttribute("data-property", control.property);
    row.append(label, input);
    return row;
  }

  private buildStructureSection(): void {
    const section = this.section("Structure");
    const actions = this.create("div", "sc-ep-actions");

    this.hideBtn = this.button("sc-ep-btn", "Hide", () => this.toggleHide());
    this.deleteBtn = this.button("sc-ep-btn", "Delete", () => this.toggleDelete());
    const up = this.button("sc-ep-btn", "Move up", () => this.move(-1));
    const down = this.button("sc-ep-btn", "Move down", () => this.move(1));

    actions.append(this.hideBtn, this.deleteBtn, up, down);
    section.appendChild(actions);
  }

  private buildInsertSection(): void {
    const section = this.section("Add element");
    const row = this.create("div", "sc-ep-row sc-ep-insert");

    const tag = this.create("select", "sc-ep-select sc-ep-insert-tag") as HTMLSelectElement;
    for (const t of INSERT_TAGS) {
      const option = this.create("option") as HTMLOptionElement;
      option.value = t;
      option.textContent = `<${t}>`;
      tag.appendChild(option);
    }
    const text = this.create("input", "sc-ep-input sc-ep-insert-text") as HTMLInputElement;
    text.type = "text";
    text.placeholder = "Text (optional)";

    const add = this.button("sc-ep-btn sc-ep-insert-add", "Insert after", () =>
      this.insertAfter((tag as HTMLSelectElement).value || "div", (text as HTMLInputElement).value),
    );

    row.append(tag, text, add);
    section.appendChild(row);
  }

  private buildFooter(): void {
    const footer = this.create("div", "sc-ep-footer");
    this.countEl = this.create("div", "sc-ep-count");
    this.discardBtn = this.button("sc-ep-discard", "Discard edits", () => this.onDiscard());
    footer.append(this.countEl, this.discardBtn);
    this.root.appendChild(footer);

    const hint = this.create("div", "sc-ep-hint");
    hint.textContent = "Edits stay private until you submit them as a comment.";
    this.root.appendChild(hint);

    // The bridge to submission (U13): finalize the buffered edits as a template
    // comment. Disabled until there is at least one edit to save.
    this.saveBtn = this.button("sc-ep-save", "Save as comment", () => this.cb.onSave());
    this.root.appendChild(this.saveBtn);
  }

  // --- Recording ----------------------------------------------------------

  private recordStyle(control: StyleControl, after: string): void {
    const before = this.originalFor(control.property);
    applyStylePreview(this.el, control.property, after);
    this.cb.record(buildStyleOp({ target: this.target, property: control.property, before, after }));
    this.refreshCount();
  }

  private recordText(after: string): void {
    const before = this.originalText ?? "";
    const next = after.replace(/\s+/g, " ").trim();
    applyTextPreview(this.el, after);
    this.cb.record(buildTextOp(this.target, before, next));
    this.refreshCount();
  }

  private toggleHide(): void {
    if (this.deleted) return; // a deleted element is already hidden
    if (!this.hidden) {
      this.priorDisplay = previewHide(this.el);
      this.cb.record(buildSetVisibilityOp(this.target, true));
      this.hidden = true;
      if (this.hideBtn) this.hideBtn.textContent = "Show";
    } else {
      previewShow(this.el, this.priorDisplay);
      // Recording the inverse coalesces the hide away (net no-op) in the session.
      this.cb.record(buildSetVisibilityOp(this.target, false));
      this.hidden = false;
      if (this.hideBtn) this.hideBtn.textContent = "Hide";
    }
    this.refreshCount();
  }

  private toggleDelete(): void {
    if (!this.deleted) {
      this.removeOp = buildRemoveOp(this.target);
      this.cb.record(this.removeOp);
      // Delete is intent; the preview hides (never removes framework nodes, G12).
      this.priorDisplay = previewHide(this.el);
      this.deleted = true;
      if (this.deleteBtn) this.deleteBtn.textContent = "Undo delete";
    } else {
      if (this.removeOp) this.cb.revert(this.removeOp);
      this.removeOp = null;
      previewShow(this.el, this.priorDisplay);
      this.deleted = false;
      if (this.deleteBtn) this.deleteBtn.textContent = "Delete";
    }
    this.refreshCount();
  }

  private move(direction: -1 | 1): void {
    const parent = this.el.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children);
    const from = siblings.indexOf(this.el);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= siblings.length) return; // no-op at the edges
    const refSibling = siblings[to];
    const insertion: InsertionPoint = {
      parent: buildEditTarget(parent, this.doc),
      reference: refSibling ? buildEditTarget(refSibling, this.doc) : undefined,
      position: direction < 0 ? "before" : "after",
    };
    previewOrder(this.el, to);
    this.cb.record(buildMoveOp(this.target, insertion, from, to));
    this.refreshCount();
  }

  private insertAfter(tag: string, text: string): void {
    const node: NewNode = { tag };
    const trimmed = text.trim();
    if (trimmed) node.text = trimmed;
    const parent = this.el.parentElement;
    const insertion: InsertionPoint = {
      parent: parent ? buildEditTarget(parent, this.doc) : undefined,
      reference: buildEditTarget(this.el, this.doc),
      position: "after",
    };
    this.cb.record(buildInsertOp(insertion, node, this.target));
    this.previewGhost(tag, trimmed);
    this.refreshCount();
  }

  // --- Discard ------------------------------------------------------------

  private onDiscard(): void {
    if (!this.discardArmed) {
      this.discardArmed = true;
      this.discardBtn.textContent = "Confirm discard?";
      this.discardBtn.className = "sc-ep-discard sc-ep-discard-armed";
      return;
    }
    this.cb.discard();
    this.revertPreviews();
    this.discardArmed = false;
    this.discardBtn.textContent = "Discard edits";
    this.discardBtn.className = "sc-ep-discard";
    this.refreshCount();
  }

  /** Best-effort revert of THIS element's ephemeral previews on discard. */
  private revertPreviews(): void {
    for (const [property, original] of this.originals) {
      if (original != null) applyStylePreview(this.el, property, original);
    }
    this.originals.clear();
    if (this.originalText != null) applyTextPreview(this.el, this.originalText);
    if (this.hidden || this.deleted) previewShow(this.el, this.priorDisplay);
    this.hidden = false;
    this.deleted = false;
    if (this.hideBtn) this.hideBtn.textContent = "Hide";
    if (this.deleteBtn) this.deleteBtn.textContent = "Delete";
    for (const ghost of this.ghosts.splice(0)) {
      try {
        ghost.remove();
      } catch {
        /* best-effort */
      }
    }
  }

  // --- Helpers ------------------------------------------------------------

  /** Snapshot the developer's build value for a property (once, before preview). */
  private originalFor(property: string): string | null {
    if (!this.originals.has(property)) {
      this.originals.set(property, readComputedValue(this.el, property));
    }
    return this.originals.get(property) ?? null;
  }

  private refreshCount(): void {
    const n = this.cb.count();
    this.countEl.textContent = n === 1 ? "1 edit" : `${n} edits`;
    this.saveBtn.disabled = n === 0;
  }

  /** True for a leaf (no element children) — safe to edit text without clobbering structure. */
  private isTextLeaf(): boolean {
    try {
      return (this.el.children?.length ?? 0) === 0;
    } catch {
      return false;
    }
  }

  /** Inject an ephemeral ghost node for an insert preview (ours; removed on discard/destroy). */
  private previewGhost(tag: string, text: string): void {
    try {
      const ghost = this.doc.createElement(tag);
      ghost.setAttribute("data-sc-ghost", "1");
      if (text) ghost.textContent = text;
      const parent = this.el.parentElement;
      if (parent) {
        insertAfter(parent, ghost, this.el);
        this.ghosts.push(ghost);
      }
    } catch {
      /* preview is best-effort */
    }
  }

  private section(title: string): HTMLElement {
    const section = this.create("div", "sc-ep-section");
    const heading = this.create("div", "sc-ep-section-title");
    heading.textContent = title;
    section.appendChild(heading);
    this.root.appendChild(section);
    return section;
  }

  private create(tag: string, className?: string): HTMLElement {
    const el = this.doc.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  private button(
    className: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = this.doc.createElement("button") as HTMLButtonElement;
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    this.on(btn, "click", onClick);
    return btn;
  }

  /** Register a listener and track its removal for {@link destroy}. */
  private on(target: Listenable, type: string, handler: () => void): void {
    const wrapped = (_e: unknown): void => {
      try {
        handler();
      } catch {
        /* an edit control must never throw into the host page */
      }
    };
    target.addEventListener(type, wrapped);
    this.disposers.push(() => target.removeEventListener?.(type, wrapped));
  }
}

/** A short human label for the bound element, e.g. `button#submit` / `h1.hero`. */
function describeElement(el: Element): string {
  const tag = el.tagName?.toLowerCase() ?? "node";
  const id = el.getAttribute?.("id");
  if (id) return `${tag}#${id}`;
  const cls =
    (el.getAttribute?.("class") || (el as { className?: string }).className || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)[0];
  return cls ? `${tag}.${cls}` : tag;
}

/** Insert `node` immediately after `ref` within `parent` (falls back to append). */
function insertAfter(parent: Element, node: Element, ref: Element): void {
  const next = (ref as { nextSibling?: ChildNode | null }).nextSibling ?? null;
  const insertBefore = (parent as {
    insertBefore?: (n: Element, ref: ChildNode | null) => void;
  }).insertBefore;
  if (typeof insertBefore === "function") {
    insertBefore.call(parent, node, next as ChildNode | null);
  } else {
    parent.appendChild(node);
  }
}
