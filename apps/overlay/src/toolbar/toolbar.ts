/**
 * The mode-switching toolbar (R9). Selection modes with a spring-sliding
 * active indicator, plus the reviewer chip and the multi-mode "Annotate N"
 * confirm. Pure presentation + callbacks; the active mode and the multi count
 * are pushed in by the controller.
 *
 * Modes are mouse-driven only — single-letter shortcuts were removed because
 * they fired while typing (Shadow DOM retargeting hid the real event target).
 */
import type { SelectionMode } from "../core/types.js";
import { slidePill } from "../shell/motion.js";
import { createListenerBag } from "../core/listener-bag.js";

interface ModeDef {
  mode: SelectionMode;
  label: string;
  icon: string;
}

/** Minimal 13px stroke icons (currentColor) for each selection mode. */
const ICONS: Record<SelectionMode, string> = {
  // Cursor arrow — the passive Browse mode (click through, navigate normally).
  browse:
    '<svg viewBox="0 0 14 14" fill="none"><path d="M2.8 2 L2.8 10.8 L5.2 8.5 L6.9 11.9 L8.3 11.2 L6.6 7.9 L10 7.9 Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  element:
    '<svg viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.5"/></svg>',
  area:
    '<svg viewBox="0 0 14 14" fill="none"><path d="M1.5 4V3a1.5 1.5 0 0 1 1.5-1.5h1M9.5 1.5H11A1.5 1.5 0 0 1 12.5 3v1M12.5 10v1a1.5 1.5 0 0 1-1.5 1.5h-1M4.5 12.5H3A1.5 1.5 0 0 1 1.5 11v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  text:
    '<svg viewBox="0 0 14 14" fill="none"><path d="M2.5 3.5V2h9v1.5M7 2v10M5 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  multi:
    '<svg viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="7.5" height="7.5" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 5v4.5A3 3 0 0 1 9.5 12.5H5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  // Pencil — the visual-editor mode (U9). Distinct from the annotation modes.
  edit:
    '<svg viewBox="0 0 14 14" fill="none"><path d="M9.4 2.3l2.3 2.3M8.2 3.5 2.6 9.1l-.6 2.9 2.9-.6 5.6-5.6-2.3-2.3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const MODES: ModeDef[] = [
  { mode: "browse", label: "Browse", icon: ICONS.browse },
  { mode: "element", label: "Element", icon: ICONS.element },
  { mode: "area", label: "Area", icon: ICONS.area },
  { mode: "text", label: "Text", icon: ICONS.text },
  { mode: "multi", label: "Multi", icon: ICONS.multi },
  { mode: "edit", label: "Edit", icon: ICONS.edit },
];

export interface ToolbarCallbacks {
  onModeChange(mode: SelectionMode): void;
  onConfirmMulti(): void;
  onChangeName(): void;
  /** Fired when the reviewer clicks "Exit". Absent → the Exit button is hidden. */
  onExit?(): void;
}

export class Toolbar {
  private readonly el: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly buttons = new Map<SelectionMode, HTMLButtonElement>();
  private readonly confirmBtn: HTMLButtonElement;
  private readonly chipName: HTMLElement;
  private pillPlaced = false;
  private readonly listeners = createListenerBag();

  constructor(
    doc: Document,
    parent: HTMLElement,
    private readonly callbacks: ToolbarCallbacks,
  ) {
    this.el = doc.createElement("div");
    this.el.className = "sc-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "SuperComment");

    // The sliding active indicator sits behind the buttons.
    this.pill = doc.createElement("div");
    this.pill.className = "sc-mode-pill";
    this.pill.setAttribute("aria-hidden", "true");
    this.el.appendChild(this.pill);

    for (const def of MODES) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "sc-mode-btn";
      btn.setAttribute("data-mode", def.mode);
      btn.setAttribute("aria-pressed", "false");
      btn.title = def.label;

      const icon = doc.createElement("span");
      icon.className = "sc-mode-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = def.icon;
      const label = doc.createElement("span");
      label.textContent = def.label;
      btn.append(icon, label);

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
    change.textContent = "Change";
    change.addEventListener("click", () => callbacks.onChangeName());
    chip.append(reviewing, this.chipName, change);

    this.el.append(this.confirmBtn, sep, chip);

    // Exit (U18) — ends the review session. Only rendered when the host wired an
    // onExit handler (top-level embedded / tunnel; never the device-mode child).
    if (callbacks.onExit) {
      const exit = doc.createElement("button");
      exit.type = "button";
      exit.className = "sc-exit";
      exit.title = "End review session";
      exit.setAttribute("aria-label", "End review session");
      exit.textContent = "Exit";
      exit.addEventListener("click", () => callbacks.onExit?.());
      this.el.appendChild(exit);
    }

    parent.appendChild(this.el);

    // Keep the indicator aligned if the viewport/layout shifts. Registered via a
    // listener bag so destroy() can remove it — a `resize` handler on `window`
    // outlives the overlay and would leak after Exit otherwise (OV-8).
    const view = doc.defaultView;
    if (view) this.listeners.add(view, "resize", () => this.placePill(true));
  }

  /** Highlight the active mode and toggle the multi confirm button. */
  setMode(mode: SelectionMode): void {
    for (const [m, btn] of this.buttons) {
      btn.setAttribute("aria-pressed", String(m === mode));
    }
    this.confirmBtn.style.display = mode === "multi" ? "" : "none";
    this.placePill(!this.pillPlaced);
  }

  /** Move the sliding indicator under the active button. */
  private placePill(instant: boolean): void {
    const active = Array.from(this.buttons.values()).find(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    if (!active) return;
    const place = () => {
      const x = active.offsetLeft;
      const width = active.offsetWidth;
      if (!width) return; // not laid out yet (e.g. test doubles)
      slidePill(this.pill, x, width, instant || !this.pillPlaced);
      this.pillPlaced = true;
    };
    // First placement waits a frame so layout (and the entrance animation's
    // starting styles) have settled; later moves measure synchronously.
    if (!this.pillPlaced && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(place);
    } else {
      place();
    }
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

  /**
   * Tear the toolbar down: remove the window `resize` listener (the leak-prone
   * one — the button listeners live on nodes the shell removes) and detach the
   * toolbar element. Called by OverlayController.destroy().
   */
  destroy(): void {
    this.listeners.dispose();
    this.el.remove();
  }
}
