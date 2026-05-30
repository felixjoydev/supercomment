import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";

/**
 * The overlay UI is DOM code, so the intended test environment is `jsdom`
 * (per the U6 plan, and listed in this package's devDependencies). We select
 * `jsdom` when it is installed AND actually loadable.
 *
 * Why the load check: the overlay's DOM-touching modules are deliberately
 * written against an *injectable* `Document` (the controller takes `doc`), and
 * the tests drive them through a lightweight DOM double (`src/test/
 * dom-double.ts`). That keeps the suite green even where jsdom can't run — e.g.
 * this sandbox only has jsdom@29, whose transitive `html-encoding-sniffer@6`
 * does a CommonJS `require()` of an ESM-only module and throws under Node. When
 * jsdom fails to load we fall back to the `node` environment; the same tests
 * pass because they never touch the real DOM. A healthy jsdom install exercises
 * the auto-mount path against a real DOM with no test changes.
 */
const require = createRequire(import.meta.url);

function jsdomUsable(): boolean {
  try {
    require.resolve("jsdom");
    // Force the transitive module graph to evaluate so a broken build is
    // caught here (and we fall back) rather than crashing the test run.
    require("jsdom");
    return true;
  } catch {
    return false;
  }
}

export default defineConfig({
  test: {
    environment: jsdomUsable() ? "jsdom" : "node",
    include: ["src/**/*.test.ts"],
  },
});
