/**
 * Selection state machine (logic, not rendering).
 *
 * Owns the active mode, the in-progress selection for each of the four modes,
 * and the multi-select accumulation set. Kept free of any rendering so the
 * behaviour (mode switching, multi toggle, Esc cancel, payload assembly) is
 * unit-testable without a browser. The shell wires real pointer/keyboard
 * events into these methods.
 */
import type {
  CommentDraft,
  SelectionMode,
  SelectionTarget,
  Rect,
} from "../core/types.js";
import { unionRect } from "../core/geometry.js";

/** A rect provider so tests can supply element rects without a layout engine. */
export type RectFor = (el: Element) => Rect;

export class SelectionState {
  private mode: SelectionMode = "element";
  /** Single completed target for element / area / text modes. */
  private pending: SelectionTarget | null = null;
  /** Accumulated elements for multi mode (insertion order preserved). */
  private readonly multi: Element[] = [];
  /** True while an area drag is in progress. */
  private dragging = false;
  private dragStart: { x: number; y: number } | null = null;

  constructor(private readonly rectFor: RectFor) {}

  getMode(): SelectionMode {
    return this.mode;
  }

  /** Switching modes always discards any in-progress selection. */
  setMode(mode: SelectionMode): void {
    this.mode = mode;
    this.clear();
  }

  /** The completed, ready-to-annotate target, or null if none yet. */
  getPending(): SelectionTarget | null {
    return this.pending;
  }

  /** Current multi-select set (copy). */
  getMultiSelection(): Element[] {
    return [...this.multi];
  }

  isDragging(): boolean {
    return this.dragging;
  }

  /** Start point of the active area drag, or null. */
  getDragStart(): { x: number; y: number } | null {
    return this.dragStart;
  }

  /** Esc / dismiss — drop any in-progress selection without committing. */
  clear(): void {
    this.pending = null;
    this.multi.length = 0;
    this.dragging = false;
    this.dragStart = null;
  }

  // --- Element mode -------------------------------------------------------

  /** Element mode click: select exactly one element and open the form. */
  selectElement(el: Element): SelectionTarget {
    const target: SelectionTarget = {
      kind: "element",
      element: el,
      rect: this.rectFor(el),
    };
    this.pending = target;
    return target;
  }

  // --- Area mode ----------------------------------------------------------

  beginAreaDrag(x: number, y: number): void {
    this.dragging = true;
    this.dragStart = { x, y };
  }

  /** Finish an area drag; produces a region selection. */
  endAreaDrag(x: number, y: number): SelectionTarget | null {
    if (!this.dragStart) return null;
    const rect: Rect = {
      x: Math.min(this.dragStart.x, x),
      y: Math.min(this.dragStart.y, y),
      width: Math.abs(x - this.dragStart.x),
      height: Math.abs(y - this.dragStart.y),
    };
    this.dragging = false;
    this.dragStart = null;
    // Ignore a zero-area accidental click.
    if (rect.width < 2 && rect.height < 2) {
      this.pending = null;
      return null;
    }
    const target: SelectionTarget = { kind: "area", rect };
    this.pending = target;
    return target;
  }

  // --- Text mode ----------------------------------------------------------

  /** Text mode: capture the quoted selected text + its rect. */
  selectText(quotedText: string, rect: Rect): SelectionTarget | null {
    const text = quotedText.trim();
    if (!text) {
      this.pending = null;
      return null;
    }
    const target: SelectionTarget = { kind: "text", quotedText: text, rect };
    this.pending = target;
    return target;
  }

  // --- Multi mode ---------------------------------------------------------

  /**
   * Toggle an element in the multi-select set: clicking an unselected element
   * adds it; clicking an already-selected one removes it. Returns true if the
   * element ended up selected.
   */
  toggleMulti(el: Element): boolean {
    const idx = this.multi.indexOf(el);
    if (idx === -1) {
      this.multi.push(el);
      return true;
    }
    this.multi.splice(idx, 1);
    return false;
  }

  /** Number of elements currently accumulated in multi mode. */
  multiCount(): number {
    return this.multi.length;
  }

  /**
   * Confirm the multi-select set as ONE target (the "Annotate N" action).
   * Requires at least one element; the rect is the union of all selected
   * elements so the form/marker can anchor sensibly.
   */
  confirmMulti(): SelectionTarget | null {
    if (this.multi.length === 0) return null;
    const elements = [...this.multi];
    const rect = unionRect(elements.map((el) => this.rectFor(el)));
    const target: SelectionTarget = { kind: "multi", elements, rect };
    this.pending = target;
    return target;
  }
}

/** A draft is submittable only when the note has content. */
export function isDraftSubmittable(draft: CommentDraft): boolean {
  return draft.note.trim().length > 0;
}
