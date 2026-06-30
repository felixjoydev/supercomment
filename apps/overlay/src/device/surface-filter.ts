import type { DeviceSurface } from "@supercomment/shared";

/**
 * Pure helpers for segregating comments by device surface, so a comment made on
 * mobile only appears in mobile mode (and feeds the mobile toggle's count), etc.
 * Missing/legacy surface is treated as "web" — older comments stay on desktop.
 */

export function effectiveSurface(
  surface: DeviceSurface | undefined,
): DeviceSurface {
  return surface ?? "web";
}

/** Keep only the items whose effective surface matches `surface`. */
export function filterBySurface<T extends { surface?: DeviceSurface }>(
  items: T[],
  surface: DeviceSurface,
): T[] {
  return items.filter((item) => effectiveSurface(item.surface) === surface);
}

/** Count items per surface (every bucket present, defaulting to 0). */
export function countBySurface<T extends { surface?: DeviceSurface }>(
  items: T[],
): Record<DeviceSurface, number> {
  const counts: Record<DeviceSurface, number> = {
    web: 0,
    mobile: 0,
    tablet: 0,
    responsive: 0,
  };
  for (const item of items) {
    counts[effectiveSurface(item.surface)] += 1;
  }
  return counts;
}
