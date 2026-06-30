import type { DeviceSurface } from "./schema.js";

/**
 * Device-surface classification + presets for responsive capture.
 *
 * `deviceSurfaceForWidth` is the pure rule that turns a captured viewport width
 * into a surface tag, so a comment made on a phone (or a narrow window) is
 * auto-labelled "mobile" without any toolbar. The device-mode toolbar (Phase 1)
 * sets the surface explicitly instead.
 */

/** Upper bounds (CSS px, exclusive) for width-based surface classification. */
export const MOBILE_MAX_WIDTH = 640;
export const TABLET_MAX_WIDTH = 1024;

/** Classify a viewport width into a device surface. Never returns "responsive". */
export function deviceSurfaceForWidth(
  width: number | undefined,
): DeviceSurface | undefined {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    return undefined;
  }
  if (width < MOBILE_MAX_WIDTH) {
    return "mobile";
  }
  if (width < TABLET_MAX_WIDTH) {
    return "tablet";
  }
  return "web";
}

/** A selectable device in the device-mode toolbar (Phase 1). */
export interface DevicePreset {
  id: string;
  label: string;
  surface: DeviceSurface;
  width: number;
  height: number;
}

/** Default device presets offered by the toolbar. */
export const DEVICE_PRESETS: DevicePreset[] = [
  { id: "mobile", label: "Mobile", surface: "mobile", width: 375, height: 812 },
  { id: "tablet", label: "Tablet", surface: "tablet", width: 768, height: 1024 },
  { id: "desktop", label: "Web", surface: "web", width: 1280, height: 800 },
];
