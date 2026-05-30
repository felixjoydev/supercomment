/**
 * Selection visuals: a single element highlight box and the multi-select set's
 * highlight boxes, plus the rubber-band rectangle for area drags. These are
 * non-interactive (pointer-events: none) so they never intercept clicks.
 */
import type { Rect } from "../core/types.js";

export class HighlightLayer {
  private readonly container: HTMLElement;

  constructor(
    private readonly doc: Document,
    parent: HTMLElement,
  ) {
    this.container = doc.createElement("div");
    this.container.className = "sc-highlight-container";
    parent.appendChild(this.container);
  }

  /** Replace all element highlights with boxes for the given rects. */
  showElements(rects: Rect[]): void {
    this.container.replaceChildren();
    for (const rect of rects) {
      this.container.appendChild(this.box("sc-highlight", rect));
    }
  }

  /** Show a single rubber-band area rectangle. */
  showArea(rect: Rect): void {
    this.container.replaceChildren();
    this.container.appendChild(this.box("sc-area", rect));
  }

  /** Clear all highlights. */
  clear(): void {
    this.container.replaceChildren();
  }

  /** Count of currently drawn highlight boxes (tests). */
  count(): number {
    return this.container.childElementCount;
  }

  private box(className: string, rect: Rect): HTMLElement {
    const el = this.doc.createElement("div");
    el.className = className;
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    return el;
  }
}
