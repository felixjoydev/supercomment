import { defineConfig } from "tsup";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  // After a successful build, emit a content-hashed copy of the IIFE plus a
  // small manifest (U1). The web app's `prebuild` reads `dist/manifest.json` to
  // discover the current hashed name and publishes it as an immutable static
  // asset (apps/web/public/sc/). We KEEP emitting the unhashed
  // `overlay.global.js` so the CLI's existing read
  // (apps/cli/src/start/index.ts) and the dormant tunnel path are unaffected.
  onSuccess: async () => {
    const distDir = join(process.cwd(), "dist");
    const source = join(distDir, "overlay.global.js");
    const bytes = await readFile(source);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const hashedName = `overlay.${hash}.global.js`;
    await copyFile(source, join(distDir, hashedName));
    await writeFile(
      join(distDir, "manifest.json"),
      JSON.stringify({ overlay: hashedName }, null, 2) + "\n",
      "utf8",
    );
  },
});
