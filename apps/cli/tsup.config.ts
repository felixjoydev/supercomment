import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin/index.ts"],
  outDir: "dist/bin",
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  // Emit a shebang so the built bin is directly executable.
  banner: { js: "#!/usr/bin/env node" },
});
