/**
 * A small collector of teardown callbacks — the overlay's uniform "bind now,
 * unbind on destroy" primitive (plans/008).
 *
 * `add` registers a DOM listener AND remembers how to remove it; `push` registers
 * an arbitrary teardown; `dispose` runs and clears every registered teardown once
 * (best-effort — one failure never skips the rest). This exists because a bound
 * listener on a long-lived target (window/document) OUTLIVES the overlay unless it
 * is explicitly removed — the class of bug behind the toolbar resize leak (OV-8).
 */

/** The subset of EventTarget we bind against (Window / Document / Element all satisfy it). */
export interface ListenerTarget {
  addEventListener(
    type: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    handler: EventListener,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface ListenerBag {
  /** Bind `handler` to `target[type]` and remember how to unbind it on dispose. */
  add(
    target: ListenerTarget,
    type: string,
    handler: (e: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  /** Register an arbitrary teardown thunk to run on dispose. */
  push(dispose: () => void): void;
  /** Run + clear every registered teardown (idempotent, best-effort). */
  dispose(): void;
}

export function createListenerBag(): ListenerBag {
  const disposers: Array<() => void> = [];
  return {
    add(target, type, handler, options) {
      target.addEventListener(type, handler as EventListener, options);
      disposers.push(() =>
        target.removeEventListener(type, handler as EventListener, options),
      );
    },
    push(dispose) {
      disposers.push(dispose);
    },
    dispose() {
      for (const d of disposers.splice(0)) {
        try {
          d();
        } catch {
          // best-effort teardown — one failure must not skip the rest
        }
      }
    },
  };
}
