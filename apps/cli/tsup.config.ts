import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin/index.ts"],
  outDir: "dist/bin",
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  // Bundle the internal workspace package into the published binary so the npm
  // tarball is self-contained (workspace:* deps can't ship to a registry). The
  // real runtime deps (zod, supabase-js, MCP SDK) stay external and are listed
  // in package.json `dependencies` for npm to install.
  noExternal: [/^@supercomment\//],
  // Emit a shebang so the built bin is directly executable.
  banner: { js: "#!/usr/bin/env node" },
});
