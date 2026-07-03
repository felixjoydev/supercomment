/**
 * Allow/deny predicates for safely applying a saved `VisualChangeSet` (the U14
 * "opt-in modified view") to a viewer's live DOM.
 *
 * A change-set is attacker-influenceable data — a stored "template" comment that
 * the overlay re-applies with `createElement` + `setAttribute`. Without limits
 * that is a stored-DOM-XSS sink: a saved op with `{tag:'script'}`,
 * `{attrs:{onerror:'…'}}`, or a `setAttr` writing `href="javascript:…"` would run
 * JS in another viewer's session on the app origin. These predicates constrain
 * what may be inserted/set, and are enforced in BOTH layers (defense in depth):
 *   - the zod schema (`newNodeSchema` / `changeOpSchema` refinements), so a
 *     hostile change-set fails validation before it is ever stored/loaded, and
 *   - the apply layer (`makeGhost` / `bindOp` in apps/overlay), so an op that
 *     somehow bypassed validation still can't execute.
 *
 * Pure + dependency-free so both the node build and the browser overlay import
 * them and they are trivially unit-tested.
 */

/**
 * Tags that can execute script, (re)load external content, or inject
 * document-level metadata — never insertable by a saved template. A visual
 * annotation only ever needs presentational elements, so this deny-list is
 * safe and the rest of the element space stays available.
 */
export const BLOCKED_INSERT_TAGS: ReadonlySet<string> = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "style",
  "meta",
  "base",
  "frame",
  "frameset",
  "applet",
  "template",
  "noscript",
  "portal",
  "svg", // can carry <script> / <foreignObject>
  "math", // MathML can carry event handlers / hrefs
]);

/**
 * Attributes that carry a URL the browser will fetch or navigate to — their
 * value must be scheme-checked so `javascript:` / hostile `data:` can't slip in.
 */
const URL_BEARING_ATTRS: ReadonlySet<string> = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "data",
  "poster",
  "background",
  "cite",
  "ping",
  "srcset",
  "longdesc",
  "usemap",
  "profile",
  "manifest",
]);

/** True iff `tag` is a valid element name that is safe to insert. */
export function isInsertableTag(tag: string): boolean {
  const t = tag.trim().toLowerCase();
  // A syntactically valid HTML / custom-element name (letter, then letters /
  // digits / hyphens). Rejects `<img src=x>`, whitespace, empty, etc.
  if (!/^[a-z][a-z0-9-]*$/.test(t)) return false;
  return !BLOCKED_INSERT_TAGS.has(t);
}

/** True iff `name` is an event-handler attribute (`onclick`, `onerror`, …). */
export function isEventHandlerAttrName(name: string): boolean {
  return /^on/i.test(name.trim());
}

/** True iff `name` is an attribute whose value is a URL the browser resolves. */
export function isUrlBearingAttr(name: string): boolean {
  return URL_BEARING_ATTRS.has(name.trim().toLowerCase());
}

/**
 * True iff a URL attribute value is safe. Rejects `javascript:` / `vbscript:`
 * and script-capable `data:` URLs; allows ordinary URLs and non-executable
 * raster `data:image/*` (but NOT `data:image/svg+xml`, which can carry script).
 * Leading control chars / whitespace are stripped first so `java\tscript:` and
 * ` javascript:` can't hide the scheme.
 */
export function isSafeUrlValue(value: string): boolean {
  const v = value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return false;
  if (v.startsWith("data:")) {
    return /^data:image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)[;,]/.test(
      v,
    );
  }
  return true;
}

/**
 * True iff the `(name, value)` attribute pair is safe to set on live DOM.
 * Rejects event handlers and `srcdoc` outright, scheme-checks URL attributes,
 * and allows everything else (including `style`, whose CSS previews are how the
 * editor works and which cannot execute script in modern browsers).
 */
export function isSafeAttr(name: string, value: string): boolean {
  const n = name.trim().toLowerCase();
  if (n === "") return false;
  if (isEventHandlerAttrName(n)) return false;
  if (n === "srcdoc") return false; // an iframe raw-HTML document
  if (isUrlBearingAttr(n)) return isSafeUrlValue(value);
  return true;
}
