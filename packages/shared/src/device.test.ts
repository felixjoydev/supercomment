import { describe, it, expect } from "vitest";

import { deviceSurfaceForWidth, DEVICE_PRESETS } from "./device.js";

describe("deviceSurfaceForWidth", () => {
  it("classifies by width", () => {
    expect(deviceSurfaceForWidth(375)).toBe("mobile");
    expect(deviceSurfaceForWidth(639)).toBe("mobile");
    expect(deviceSurfaceForWidth(640)).toBe("tablet");
    expect(deviceSurfaceForWidth(768)).toBe("tablet");
    expect(deviceSurfaceForWidth(1023)).toBe("tablet");
    expect(deviceSurfaceForWidth(1024)).toBe("web");
    expect(deviceSurfaceForWidth(1920)).toBe("web");
  });

  it("returns undefined for invalid widths", () => {
    expect(deviceSurfaceForWidth(undefined)).toBeUndefined();
    expect(deviceSurfaceForWidth(0)).toBeUndefined();
    expect(deviceSurfaceForWidth(-5)).toBeUndefined();
    expect(deviceSurfaceForWidth(Number.NaN)).toBeUndefined();
  });
});

describe("DEVICE_PRESETS", () => {
  it("provides mobile/tablet/web presets with sane dimensions", () => {
    const ids = DEVICE_PRESETS.map((p) => p.id);
    expect(ids).toContain("mobile");
    expect(ids).toContain("tablet");
    for (const preset of DEVICE_PRESETS) {
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.height).toBeGreaterThan(0);
    }
  });
});
