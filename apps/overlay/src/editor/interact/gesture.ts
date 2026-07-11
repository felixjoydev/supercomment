/**
 * U12 — the press-drag gesture recognizer.
 *
 * A tiny, DOM-agnostic state machine shared by resize (U12) and drag-reorder
 * (U13): a pointer press that moves past an activation distance becomes a DRAG
 * (start → move* → commit); a press that releases below the threshold is a TAP
 * that the caller forwards to the normal chrome pass-through (click-to-select /
 * dblclick-to-edit still work through the selection box). Any abort signal
 * (pointercancel, lost capture, window blur, Escape) cancels a live drag only.
 *
 * The recognizer holds NO DOM — the inspector/controller translate real pointer
 * events + setPointerCapture into `down/move/up/cancel` calls, so the transition
 * logic (threshold, tap-vs-drag, delta stream, cancel) is unit-tested without a
 * browser. Callbacks never throw into the host page (each is guarded).
 */

export interface Point {
  x: number;
  y: number;
}

export interface GestureCallbacks {
  /** Fired ONCE when the press crosses the activation distance (drag begins). */
  onStart?(start: Point): void;
  /** Fired on each move after activation, with the delta from the start point. */
  onMove?(current: Point, delta: Point): void;
  /** Fired on release AFTER activation (a committed drag). */
  onCommit?(current: Point, delta: Point): void;
  /** Fired when a live drag is aborted (cancel / Escape / blur / lost capture). */
  onAbort?(): void;
  /** Fired on release BELOW the threshold — a click, not a drag (pass-through). */
  onTap?(start: Point): void;
}

export interface GestureOptions {
  /** Movement (px) before a press becomes a drag (default 5). */
  activationDistance?: number;
}

type Phase = "idle" | "pressed" | "active";

const DEFAULT_ACTIVATION = 5;

const delta = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

function guard(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    /* a gesture callback must never throw into the host page */
  }
}

export class Gesture {
  private phase: Phase = "idle";
  private start: Point = { x: 0, y: 0 };
  private readonly activation: number;

  constructor(
    private readonly cb: GestureCallbacks,
    opts: GestureOptions = {},
  ) {
    this.activation = opts.activationDistance ?? DEFAULT_ACTIVATION;
  }

  /** Is a drag currently live (activation crossed, not yet committed/aborted)? */
  get active(): boolean {
    return this.phase === "active";
  }

  /** Pointer pressed: arm the recognizer (not yet a drag). */
  down(p: Point): void {
    this.start = { x: p.x, y: p.y };
    this.phase = "pressed";
  }

  /** Pointer moved: cross the threshold to activate, then stream deltas. */
  move(p: Point): void {
    if (this.phase === "idle") return;
    if (this.phase === "pressed") {
      const d = delta(p, this.start);
      if (Math.hypot(d.x, d.y) < this.activation) return; // still a press, not a drag
      this.phase = "active";
      guard(() => this.cb.onStart?.({ ...this.start }));
    }
    if (this.phase === "active") {
      const d = delta(p, this.start);
      guard(() => this.cb.onMove?.({ ...p }, d));
    }
  }

  /** Pointer released: commit a live drag, else emit a tap. */
  up(p: Point): void {
    if (this.phase === "active") {
      const d = delta(p, this.start);
      guard(() => this.cb.onCommit?.({ ...p }, d));
    } else if (this.phase === "pressed") {
      guard(() => this.cb.onTap?.({ ...this.start }));
    }
    this.phase = "idle";
  }

  /** Abort: cancel a LIVE drag (pointercancel / Escape / blur / lost capture). */
  cancel(): void {
    const wasActive = this.phase === "active";
    this.phase = "idle";
    if (wasActive) guard(() => this.cb.onAbort?.());
  }
}
