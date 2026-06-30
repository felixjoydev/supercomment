import type { InteractionEvent } from "@supercomment/shared";
import { redactSecrets } from "@supercomment/shared";

import { cssEscape } from "./anchors.js";
import { HOST_ELEMENT_ID } from "../shell/root.js";

/**
 * Interaction-trail buffer (repro breadcrumbs).
 *
 * A comment is far easier to reproduce if it carries the last few things the
 * user did before clicking. We install passive listeners that keep a ring buffer
 * of the most recent N interactions (clicks, input/change, submit, navigation).
 *
 * UX-safety guarantees, by construction:
 *   - listeners are registered `{ capture: true, passive: true }` — `passive`
 *     means we *cannot* call `preventDefault`, so we can never alter app
 *     behaviour; `capture` means we still observe even if the app stops
 *     propagation,
 *   - handlers never throw out (each is wrapped) so a listener can't surface as
 *     a page error,
 *   - install-once / idempotent (like the console buffer) so repeated overlay
 *     mounts don't stack listeners.
 *
 * Privacy by design:
 *   - we record only the action *type* and a compact *selector* for its target,
 *     never the typed/entered VALUE. The canonical redactor is best-effort for
 *     token shapes and does not cover free-text PII (names, card numbers, etc.),
 *     so capturing raw input values is simply not worth the exposure — the
 *     selector + action sequence is what makes a bug reproducible.
 *   - interactions with SuperComment's own overlay UI (the comment box, etc.)
 *     are filtered out so the trail reflects the *app*, not the reviewer using
 *     the tool.
 */

type InteractionType = InteractionEvent["type"];

const DEFAULT_CAPACITY = 15;

interface RegisteredListener {
  target: EventTarget;
  type: string;
  handler: EventListener;
  options: AddEventListenerOptions;
}

interface InteractionBufferState {
  capacity: number;
  entries: InteractionEvent[];
  installed: boolean;
  listeners: RegisteredListener[];
}

const state: InteractionBufferState = {
  capacity: DEFAULT_CAPACITY,
  entries: [],
  installed: false,
  listeners: [],
};

/** Low-level ring push. Exported so the ring/eviction is unit-testable. */
export function recordInteraction(
  type: InteractionType,
  detail: { target?: string } = {},
): void {
  const entry: InteractionEvent = {
    type,
    timestamp: new Date().toISOString(),
  };
  if (detail.target) {
    entry.target = detail.target;
  }
  state.entries.push(entry);
  const overflow = state.entries.length - state.capacity;
  if (overflow > 0) {
    state.entries.splice(0, overflow);
  }
}

/** Compact, human-readable selector for an event target (best-effort). */
export function compactSelector(node: unknown): string | undefined {
  const el = node as {
    tagName?: unknown;
    getAttribute?(name: string): string | null;
  } | null;
  if (!el || typeof el.tagName !== "string") {
    return undefined;
  }
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute?.("id")?.trim();
  if (id) {
    return `${tag}#${cssEscape(id)}`;
  }
  const testId = el.getAttribute?.("data-testid")?.trim();
  if (testId) {
    return `${tag}[data-testid="${testId}"]`;
  }
  const className = el.getAttribute?.("class")?.trim().split(/\s+/)[0];
  if (className) {
    return `${tag}.${cssEscape(className)}`;
  }
  return tag;
}

/** Build the `{ target }` detail for an interaction. Pure — value is never captured. */
export function describeInteractionTarget(node: unknown): { target?: string } {
  const target = compactSelector(node);
  return target ? { target } : {};
}

/**
 * True when an event target belongs to SuperComment's own overlay UI. Events
 * from inside the overlay's shadow root are retargeted to the host element, so a
 * host-id check (plus an ancestor check for safety) reliably excludes the
 * reviewer's interactions with the tool itself.
 */
export function isWithinOverlay(node: unknown): boolean {
  const el = node as {
    id?: unknown;
    closest?: (selectors: string) => unknown;
  } | null;
  if (!el) {
    return false;
  }
  if (el.id === HOST_ELEMENT_ID) {
    return true;
  }
  try {
    if (typeof el.closest === "function") {
      return el.closest(`#${HOST_ELEMENT_ID}`) != null;
    }
  } catch {
    // Bad selector support in an exotic DOM — treat as not-overlay.
  }
  return false;
}

function safeHandler(fn: (event: Event) => void): EventListener {
  return ((event: Event) => {
    try {
      fn(event);
    } catch {
      // A breadcrumb listener must never surface as a page error.
    }
  }) as EventListener;
}

function recordFromEvent(type: InteractionType, event: Event): void {
  if (isWithinOverlay(event.target)) {
    return;
  }
  recordInteraction(type, describeInteractionTarget(event.target));
}

function navigationPath(): string | undefined {
  try {
    const loc = (
      globalThis as { location?: { pathname?: string; search?: string } }
    ).location;
    if (!loc?.pathname) {
      return undefined;
    }
    return redactSecrets(`${loc.pathname}${loc.search ?? ""}`);
  } catch {
    return undefined;
  }
}

function addListener(
  target: EventTarget,
  type: string,
  fn: (event: Event) => void,
): void {
  const handler = safeHandler(fn);
  const options: AddEventListenerOptions = { capture: true, passive: true };
  target.addEventListener(type, handler, options);
  state.listeners.push({ target, type, handler, options });
}

/**
 * Install the passive interaction listeners. Safe to call multiple times; only
 * the first call takes effect. Pass `capacity` to size the ring buffer.
 */
export function installInteractionBuffer(capacity = DEFAULT_CAPACITY): void {
  state.capacity = capacity;
  if (state.installed) {
    return;
  }
  state.installed = true;

  const docTarget: EventTarget | undefined =
    typeof document !== "undefined" ? document : undefined;
  if (docTarget) {
    addListener(docTarget, "click", (e) => recordFromEvent("click", e));
    addListener(docTarget, "input", (e) => recordFromEvent("input", e));
    addListener(docTarget, "change", (e) => recordFromEvent("change", e));
    addListener(docTarget, "submit", (e) => recordFromEvent("submit", e));
  }

  if (typeof globalThis.addEventListener === "function") {
    addListener(globalThis, "popstate", () =>
      recordInteraction("navigation", { target: navigationPath() }),
    );
    addListener(globalThis, "hashchange", () =>
      recordInteraction("navigation", { target: navigationPath() }),
    );
  }
}

/** Snapshot of buffered interactions, oldest first. Returns a copy. */
export function getRecentInteractions(): InteractionEvent[] {
  return state.entries.map((e) => ({ ...e }));
}

/** Remove listeners and clear the buffer. Primarily for tests/teardown. */
export function resetInteractionBuffer(): void {
  for (const { target, type, handler, options } of state.listeners) {
    try {
      target.removeEventListener(type, handler, options);
    } catch {
      // best-effort
    }
  }
  state.listeners = [];
  state.entries = [];
  state.installed = false;
}
