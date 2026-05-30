import { defineConfig } from "tsup";

export default defineConfig({
  entry: { overlay: "src/index.ts" },
  format: ["iife"],
  // Single self-contained bundle injected into the host page (no externals).
  globalName: "SuperCommentOverlay",
  platform: "browser",
  target: "es2020",
  noExternal: [/.*/],
  clean: true,
  minify: true,
  sourcemap: true,
});
