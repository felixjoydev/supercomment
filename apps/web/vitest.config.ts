import { defineConfig } from 'vitest/config';

/**
 * Node-environment unit tests for the pure logic modules (link, status, slug,
 * auth-guard). jsdom is broken in this sandbox (transitive ESM-require bug), so
 * we deliberately stay on the node environment and keep all testable logic free
 * of React / Next / Supabase runtime imports. Anything needing a real browser
 * or a running Supabase is marked `// VERIFY IN REAL ENV:` rather than faked.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
