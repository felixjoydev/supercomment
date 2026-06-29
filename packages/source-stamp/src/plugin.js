"use strict";

/**
 * @supercomment/source-stamp
 * ==========================
 *
 * A tiny Babel plugin that stamps every JSX **opening element** with a single
 * build-time attribute:
 *
 *     data-sc-source="<relativePath>:<line>:<col>"
 *
 * e.g. `data-sc-source="src/components/Card.tsx:42:6"`.
 *
 * WHY THIS EXISTS
 * ---------------
 * SuperComment captures the source location of the element a reviewer clicks so
 * the AI hand-off can point at exact `file:line`. On **React 18 + the Babel dev
 * transform** this came for free from the fiber's `_debugSource`. On **React 19
 * / Next App Router** the runtime `_debugSource` / `jsxDEV` source args are GONE
 * — there is no longer any runtime source info on the fiber. So the only way to
 * recover exact `file:line` is to stamp it at build time and read it back at
 * runtime via `el.closest('[data-sc-source]')` (see
 * apps/overlay/src/capture/source.ts).
 *
 * This is **progressive enhancement** layered on top of the universal overlay
 * script (the always-on floor). The plugin runs in **preview builds only**;
 * production builds must not be stamped (the overlay never activates there, and
 * the attribute would leak source paths). Gating is the host build's job — see
 * apps/web/babel.config.js + next.config.ts for the dogfood wiring, and
 * docs/embed/install.md for the customer instructions.
 *
 * SHAPE
 * -----
 * Mirrors `@locator/babel-jsx` / `@react-dev-inspector/babel-plugin`: a default
 * export that returns `{ name, visitor: { JSXOpeningElement } }`. We do NOT
 * depend on `@babel/core` / `@babel/types` — Babel is provided by the host
 * build at runtime and handed to the plugin as the `babel` argument. The plugin
 * args are typed loosely (see plugin.d.ts) to stay dependency-light.
 *
 * BEHAVIOUR
 * ---------
 *  - Visits every `JSXOpeningElement` and appends one `data-sc-source` attribute
 *    built from `path.node.loc.start` and the file path relative to the project
 *    root (`state.file.opts.root | cwd`, falling back to `process.cwd()`).
 *  - Idempotent: skips an element that already carries `data-sc-source` (e.g. a
 *    re-run, or hand-authored markup).
 *  - Skips Fragments (`<Fragment>` / `<React.Fragment>`); they have no useful
 *    target. The shorthand `<>` compiles to a `JSXFragment` with no opening
 *    element, so the visitor never fires for it.
 *  - Skips silently when the node has no `loc` or no filename (synthetic nodes).
 *
 * Note: Babel's `loc.start.column` is 0-based and `loc.start.line` is 1-based;
 * we record both verbatim. The overlay persists file + line (column is parsed
 * but not currently stored in the shared schema).
 */

const path = require("node:path");

/** The single attribute this plugin stamps. */
const ATTR = "data-sc-source";

/**
 * Normalize the transformed file's path to a stable, forward-slashed path
 * relative to the project root. Falls back to the original path if `relative`
 * fails or the file lives outside the root.
 */
function relativeSourcePath(filename, root) {
  let rel = filename;
  try {
    rel = path.relative(root, filename) || filename;
  } catch {
    rel = filename;
  }
  // Forward slashes so the stamp is byte-identical across OSes.
  return rel.split(path.sep).join("/");
}

/** Format the attribute value: "<relativePath>:<line>:<col>". */
function formatSource(relPath, line, column) {
  return `${relPath}:${line}:${column}`;
}

/**
 * True when the JSX element is a named Fragment (`<Fragment>` /
 * `<React.Fragment>` / `<X.Fragment>`), which is not worth stamping.
 */
function isFragmentName(name) {
  if (!name || typeof name !== "object") {
    return false;
  }
  if (name.type === "JSXIdentifier") {
    return name.name === "Fragment";
  }
  if (name.type === "JSXMemberExpression") {
    return Boolean(name.property) && name.property.name === "Fragment";
  }
  return false;
}

/** True when the element already carries the `data-sc-source` attribute. */
function hasStamp(attributes) {
  if (!Array.isArray(attributes)) {
    return false;
  }
  for (const attr of attributes) {
    if (
      attr &&
      attr.type === "JSXAttribute" &&
      attr.name &&
      attr.name.name === ATTR
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Babel plugin factory.
 *
 * @param {{ types: any }} babel - the Babel API; we only use `babel.types`.
 */
function sourceStampPlugin(babel) {
  const t = babel.types;
  // `@babel/types` exposes both the lowercase (`jsxAttribute`) and the legacy
  // CapsLock (`jSXAttribute`) builders depending on version; prefer the former.
  const makeJsxIdentifier = t.jsxIdentifier || t.jSXIdentifier;
  const makeJsxAttribute = t.jsxAttribute || t.jSXAttribute;

  return {
    name: "supercomment-source-stamp",
    visitor: {
      JSXOpeningElement(nodePath, state) {
        const node = nodePath.node;
        if (!node || !node.name) {
          return;
        }
        if (isFragmentName(node.name)) {
          return;
        }
        if (hasStamp(node.attributes)) {
          return;
        }

        const loc = node.loc;
        if (!loc || !loc.start) {
          return;
        }

        const opts = (state.file && state.file.opts) || {};
        const filename = opts.filename;
        if (!filename) {
          return;
        }

        const root = opts.root || opts.cwd || state.cwd || process.cwd();
        const value = formatSource(
          relativeSourcePath(filename, root),
          loc.start.line,
          loc.start.column,
        );

        if (!makeJsxIdentifier || !makeJsxAttribute) {
          return;
        }
        node.attributes.push(
          makeJsxAttribute(makeJsxIdentifier(ATTR), t.stringLiteral(value)),
        );
      },
    },
  };
}

module.exports = sourceStampPlugin;
// Babel loaders that interop ESM/CJS look for `.default`.
module.exports.default = sourceStampPlugin;
// Exported for unit tests (and reuse) — not part of the Babel contract.
module.exports.ATTR = ATTR;
module.exports.relativeSourcePath = relativeSourcePath;
module.exports.formatSource = formatSource;
module.exports.isFragmentName = isFragmentName;
module.exports.hasStamp = hasStamp;
