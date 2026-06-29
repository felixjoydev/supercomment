/**
 * Motion helpers for the overlay (vanilla Framer Motion — `animate` from the
 * framework-agnostic `motion` entry; the overlay has no React).
 *
 * One spring everywhere (bounce 0) matches the dashboard's motion language;
 * markers get a touch of bounce because a pin landing should feel alive.
 * Everything degrades to opacity-only (or nothing) under reduced motion, and
 * every call is capability-guarded so the node/test environment (DOM doubles,
 * no rAF/WAAPI) never crashes.
 */
import { animate } from "motion";

export const SPRING = { type: "spring", duration: 0.45, bounce: 0 } as const;
export const SPRING_POP = { type: "spring", duration: 0.45, bounce: 0.28 } as const;

function reducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/** True when we can safely animate this element in this environment. */
function canAnimate(el: Element): boolean {
  return (
    typeof requestAnimationFrame === "function" &&
    typeof (el as HTMLElement).animate === "function"
  );
}

/** Card-style entrance: fade + rise + settle. Safe no-op without WAAPI. */
export function enterCard(el: HTMLElement, fromY = 8): void {
  if (!canAnimate(el)) return;
  try {
    if (reducedMotion()) {
      animate(el, { opacity: [0, 1] }, { duration: 0.15 });
      return;
    }
    animate(
      el,
      { opacity: [0, 1], transform: [`translateY(${fromY}px) scale(0.97)`, "translateY(0px) scale(1)"] },
      SPRING,
    );
  } catch {
    /* presentation only — never break the flow */
  }
}

/**
 * Quick exit: fade + slight shrink. Returns the finish promise, or null when
 * no animation could run — callers should then tear down synchronously (the
 * node test env and old browsers must not defer removal).
 */
export function exitCard(el: HTMLElement): Promise<void> | null {
  if (!canAnimate(el)) return null;
  try {
    const controls = animate(
      el,
      { opacity: 0, transform: "scale(0.98)" },
      { duration: 0.12, ease: "easeOut" },
    );
    return Promise.resolve(controls.finished ?? controls).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return null;
  }
}

/** Marker pop: scale from a visible 0.25, never from nothing. */
export function popIn(el: HTMLElement): void {
  if (!canAnimate(el)) return;
  try {
    if (reducedMotion()) {
      animate(el, { opacity: [0, 1] }, { duration: 0.15 });
      return;
    }
    animate(el, { opacity: [0, 1], transform: ["scale(0.25)", "scale(1)"] }, SPRING_POP);
  } catch {
    /* ignore */
  }
}

/**
 * Slide the toolbar's active-mode indicator to (x, width) — the vanilla
 * equivalent of a layoutId pill. First positioning is instant.
 */
export function slidePill(
  el: HTMLElement,
  x: number,
  width: number,
  instant: boolean,
): void {
  if (instant || !canAnimate(el) || reducedMotion()) {
    el.style.transform = `translateX(${x}px)`;
    el.style.width = `${width}px`;
    return;
  }
  try {
    animate(el, { transform: `translateX(${x}px)`, width: `${width}px` }, SPRING);
  } catch {
    el.style.transform = `translateX(${x}px)`;
    el.style.width = `${width}px`;
  }
}

/** Backdrop fade-in (modal). */
export function fadeIn(el: HTMLElement): void {
  if (!canAnimate(el)) return;
  try {
    animate(el, { opacity: [0, 1] }, { duration: 0.2, ease: "easeOut" });
  } catch {
    /* ignore */
  }
}
