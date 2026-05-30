/**
 * Shadow-root host setup.
 *
 * The entire overlay UI is mounted inside a single shadow root attached to one
 * injected host element. This gives us hard CSS isolation in both directions:
 * the host app's stylesheet cannot style our nodes, and our styles cannot leak
 * into the host (design-lens D-01). The host element is the only thing we add
 * to the host document.
 */
import { OVERLAY_STYLES } from "./styles.js";

/** Id of the single host element we attach to the page. */
export const HOST_ELEMENT_ID = "supercomment-overlay-host";

export interface ShellRoot {
  /** The host element added to the page (the only host-document mutation). */
  host: HTMLElement;
  /** The shadow root all overlay UI lives in. */
  shadow: ShadowRoot;
  /** The top-level interaction layer inside the shadow root. */
  layer: HTMLElement;
  /** Tear down: removes the host element from the page. */
  destroy(): void;
}

export function createShellRoot(doc: Document): ShellRoot {
  const existing = doc.getElementById(HOST_ELEMENT_ID);
  if (existing) existing.remove();

  const host = doc.createElement("div");
  host.id = HOST_ELEMENT_ID;
  // The host element itself is laid out outside normal flow and ignores
  // pointer events; only the inner UI opts back in.
  host.setAttribute(
    "style",
    "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;",
  );

  const shadow = host.attachShadow({ mode: "open" });

  const style = doc.createElement("style");
  style.textContent = OVERLAY_STYLES;
  shadow.appendChild(style);

  const layer = doc.createElement("div");
  layer.className = "sc-layer";
  shadow.appendChild(layer);

  (doc.body ?? doc.documentElement).appendChild(host);

  return {
    host,
    shadow,
    layer,
    destroy() {
      host.remove();
    },
  };
}
