import type { DevicePreset, DeviceSurface } from "@supercomment/shared";
import { DEVICE_PRESETS } from "@supercomment/shared";

/**
 * The responsive device-mode toolbar (parent shell only). Presents Web / Mobile
 * / Tablet; selecting Web exits device mode, the others enter it. Pure
 * presentation + a single `onSelect` callback — the controller wires it to the
 * {@link DeviceMode} lifecycle and pushes the active preset back via setActive.
 */

export interface DeviceToolbarCallbacks {
  /** A preset was chosen. The "web" preset means "exit device mode". */
  onSelect(preset: DevicePreset): void;
}

/** Web first (the default/normal view), then the device widths. */
const ORDERED_PRESETS: DevicePreset[] = [...DEVICE_PRESETS].sort((a, b) =>
  a.surface === "web" ? -1 : b.surface === "web" ? 1 : 0,
);

const WEB_PRESET_ID =
  ORDERED_PRESETS.find((p) => p.surface === "web")?.id ?? "desktop";

export class DeviceToolbar {
  private readonly el: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  /** Per-button count badge, keyed by the preset's surface. */
  private readonly badges = new Map<DeviceSurface, HTMLElement>();

  constructor(
    doc: Document,
    parent: HTMLElement,
    callbacks: DeviceToolbarCallbacks,
  ) {
    this.el = doc.createElement("div");
    this.el.className = "sc-device-toolbar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", "Responsive preview");

    const label = doc.createElement("span");
    label.className = "sc-device-tb-label";
    label.textContent = "Responsive";
    this.el.appendChild(label);

    for (const preset of ORDERED_PRESETS) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "sc-device-btn";
      btn.setAttribute("data-device", preset.id);
      btn.title =
        preset.surface === "web"
          ? "Full page"
          : `${preset.label} (${preset.width}×${preset.height})`;

      const text = doc.createElement("span");
      text.textContent = preset.label;
      btn.appendChild(text);

      // A count badge showing how many comments belong to this surface.
      const badge = doc.createElement("span");
      badge.className = "sc-device-count";
      badge.style.display = "none";
      btn.appendChild(badge);
      this.badges.set(preset.surface, badge);

      btn.addEventListener("click", () => callbacks.onSelect(preset));
      this.buttons.set(preset.id, btn);
      this.el.appendChild(btn);
    }

    parent.appendChild(this.el);
    this.setActive(null);
  }

  /** Highlight the active preset; null means normal (web/full-page) mode. */
  setActive(preset: DevicePreset | null): void {
    const activeId = preset?.id ?? WEB_PRESET_ID;
    for (const [id, btn] of this.buttons) {
      btn.setAttribute("aria-pressed", String(id === activeId));
    }
  }

  /** Update the per-surface comment counts shown on each toggle. */
  setCounts(counts: Partial<Record<DeviceSurface, number>>): void {
    for (const [surface, badge] of this.badges) {
      const count = counts[surface] ?? 0;
      badge.textContent = String(count);
      badge.style.display = count > 0 ? "" : "none";
    }
  }
}
