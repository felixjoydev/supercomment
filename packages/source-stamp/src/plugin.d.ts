/**
 * Public types for @supercomment/source-stamp.
 *
 * The plugin is authored as a small, dependency-free CommonJS Babel plugin
 * (plugin.js). These hand-written declarations keep `pnpm -r typecheck` green
 * and give consumers (and the unit test) a typed surface without pulling in
 * `@babel/*` type packages. Babel-facing args are intentionally loose (`any`).
 */

/** The object a Babel plugin returns. */
interface SourceStampPluginObject {
  name: string;
  visitor: {
    JSXOpeningElement(path: { node: any }, state: any): void;
  };
}

/** Babel plugin factory: stamps `data-sc-source="file:line:col"` on JSX. */
declare function sourceStampPlugin(babel: {
  types: any;
}): SourceStampPluginObject;

declare namespace sourceStampPlugin {
  /** The attribute name this plugin stamps: `"data-sc-source"`. */
  const ATTR: string;
  /** `"<relativePath>:<line>:<col>"`. */
  function formatSource(relPath: string, line: number, column: number): string;
  /** Project-root-relative, forward-slashed source path. */
  function relativeSourcePath(filename: string, root: string): string;
  /** True for `<Fragment>` / `<X.Fragment>` opening-element names. */
  function isFragmentName(name: unknown): boolean;
  /** True when the attribute list already contains `data-sc-source`. */
  function hasStamp(attributes: readonly unknown[]): boolean;
}

export = sourceStampPlugin;
