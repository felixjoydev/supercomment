/**
 * The mode-switching toolbar (R9). Four selection modes with keyboard
 * shortcuts (E/A/T/M) and an active highlight, plus the reviewer chip and the
 * multi-mode "Annotate N" confirm. Pure presentation + callbacks; the active
 * mode and the multi count are pushed in by the controller.
 */
import type { SelectionMode } from "../core/types.js";

interface ModeDef {
  mode: SelectionMode;
  label: string;
  key: string;
}

const MODES: ModeDef[] = [
  { mode: "element", label: "Element", key: "E" },
  { mode: "area", label: "Area", key: "A" },
  { mode: "text", label: "Text", key: "T" },
  { mode: "multi", label: "Multi", key: "M" },
];

export interface ToolbarCallbacks {
  onModeChange(mode: SelectionMode): void;
  onConfirmMulti(): void;
  onChangeName(): void;
}

export class Toolbar {
  private readonly el: HTMLElement;
  private readonly buttons = new Map<SelectionMode, HTMLButtonElement>();
  private readonly confirmBtn: HTMLButtonElement;
  private readonly chipName: HTMLElement;

  constructor(
    doc: Document,
    parent: HTMLElement,
    private readonly callbacks: ToolbarCallbacks,
  ) {
    this.el = doc.createElement("div");
    this.el.className = "sc-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "SuperComment");

    for (const def of MODES) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "sc-mode-btn";
      btn.setAttribute("data-mode", def.mode);
      btn.setAttribute("aria-pressed", "false");
      btn.title = `${def.label} (${def.key})`;

      const label = doc.createElement("span");
      label.textContent = def.label;
      const key = doc.createElement("span");
      key.className = "sc-mode-key";
      key.textContent = def.key;
      btn.append(label, key);

      btn.addEventListener("click", () => callbacks.onModeChange(def.mode));
      this.buttons.set(def.mode, btn);
      this.el.appendChild(btn);
    }

    this.confirmBtn = doc.createElement("button");
    this.confirmBtn.type = "button";
    this.confirmBtn.className = "sc-multi-confirm";
    this.confirmBtn.textContent = "Annotate 0";
    this.confirmBtn.style.display = "none";
    this.confirmBtn.disabled = true;
    this.confirmBtn.addEventListener("click", () => callbacks.onConfirmMulti());

    const sep = doc.createElement("div");
    sep.className = "sc-toolbar-sep";

    const chip = doc.createElement("div");
    chip.className = "sc-chip";
    const reviewing = doc.createElement("span");
    reviewing.textContent = "Reviewing as ";
    this.chipName = doc.createElement("span");
    this.chipName.className = "sc-chip-name";
    this.chipName.textContent = "guest";
    const change = doc.createElement("button");
    change.type = "button";
    change.className = "sc-chip-change";
    change.textContent = "change";
    change.addEventListener("click", () => callbacks.onChangeName());
    chip.append(reviewing, this.chipName, change);

    this.el.append(this.confirmBtn, sep, chip);
    parent.appendChild(this.el);
  }

  /** Highlight the active mode and toggle the multi confirm button. */
  setMode(mode: SelectionMode): void {
    for (const [m, btn] of this.buttons) {
      btn.setAttribute("aria-pressed", String(m === mode));
    }
    this.confirmBtn.style.display = mode === "multi" ? "" : "none";
  }

  /** Update the "Annotate N" label and enabled state. */
  setMultiCount(count: number): void {
    this.confirmBtn.textContent = `Annotate ${count}`;
    this.confirmBtn.disabled = count === 0;
  }

  /** Update the reviewer chip name (R24 "Reviewing as <name>"). */
  setReviewerName(name: string | null): void {
    this.chipName.textContent = name ?? "guest";
  }
}
