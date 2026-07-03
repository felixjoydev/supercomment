import { defineConfig, configDefaults } from "vitest/config";

/**
 * Root Vitest config. `pnpm test` runs ONE Vitest instance from the repo root
 * (default `node` environment + default include globs) — exactly as it did
 * before this file existed. Its only job is to add `**​/.claude/**` to the
 * exclude set so the run stops sweeping tests inside stale local worktrees under
 * `.claude/worktrees/` (gitignored copies of this repo that would otherwise
 * double-count and drift from the real suite).
 *
 * `exclude` REPLACES Vitest's defaults, so we spread `configDefaults.exclude`
 * to keep node_modules/dist/etc. excluded and only ADD the `.claude` rule.
 *
 * `.mts` (not `.ts`): the repo root is CommonJS (no `"type": "module"`), so a
 * `.ts` config is loaded via `require()` and throws ERR_REQUIRE_ESM on Vitest's
 * ESM-only deps. `.mts` is always loaded as ESM (same reason as
 * packages/source-stamp/vitest.config.mts).
 *
 * Per-package `vitest.config.ts` files still govern runs launched from inside a
 * package (e.g. `pnpm -r test`); this root config does not affect those.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
