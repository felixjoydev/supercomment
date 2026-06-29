import { defineConfig } from "vitest/config";

/**
 * `.mts` (not `.ts`): this package is CommonJS (the Babel plugin must be
 * `require()`-able by the host build), so a `.ts` config would be loaded via
 * `require()` and fail on ESM-only Vite. `.mts` is always loaded as ESM.
 *
 * The plugin is pure (no DOM), so the `node` environment is enough. The test
 * drives the real visitor with a faithful mock of Babel's `types` builders and
 * fake JSX nodes — mirroring the overlay's "mock the hard-to-run dep" pattern —
 * so we get meaningful coverage without an `@babel/core` devDependency.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
