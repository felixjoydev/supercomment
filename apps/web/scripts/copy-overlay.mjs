// Prebuild (U1): publish the overlay IIFE as a static, cache-busted asset.
//
// The overlay is content-hashed by its own build (apps/overlay/tsup.config.ts),
// which also writes apps/overlay/dist/manifest.json mapping "overlay" -> the
// current hashed filename. Here we copy that hashed bundle into
// apps/web/public/sc/ so Next serves it statically with immutable caching
// (public/ is output-file-traced into the deployment), and we write the
// discovered name to apps/web/lib/overlay-manifest.json, which the /sc-loader
// route imports at build time. We do NOT read the sibling package's dist at
// request time.
//
// Runs automatically before `next build` via the package.json "prebuild" hook.
// For local embedded testing under `next dev`, run it once by hand:
//   node apps/web/scripts/copy-overlay.mjs

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(webRoot, "..", "..");
const overlayDist = join(webRoot, "..", "overlay", "dist");
const overlayManifestPath = join(overlayDist, "manifest.json");
const publicScDir = join(webRoot, "public", "sc");
const libManifestPath = join(webRoot, "lib", "overlay-manifest.json");

const HASHED_BUNDLE_RE = /^overlay\..*\.global\.js(\.map)?$/;

/** Build the overlay if its hashed output is missing, so the web build is
 *  self-contained regardless of monorepo task ordering. */
function ensureOverlayBuilt() {
  if (existsSync(overlayManifestPath)) return;
  console.log(
    "[copy-overlay] overlay build output not found — building @supercomment/overlay…",
  );
  const result = spawnSync("pnpm", ["--filter", "@supercomment/overlay", "build"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  if (result.status !== 0) {
    throw new Error(
      "[copy-overlay] failed to build @supercomment/overlay. " +
        "Build it manually: pnpm --filter @supercomment/overlay build",
    );
  }
}

async function main() {
  ensureOverlayBuilt();

  if (!existsSync(overlayManifestPath)) {
    throw new Error(
      `[copy-overlay] overlay manifest missing at ${overlayManifestPath}. ` +
        "Did the overlay build succeed?",
    );
  }

  const manifest = JSON.parse(await readFile(overlayManifestPath, "utf8"));
  const bundleName = manifest && manifest.overlay;
  if (typeof bundleName !== "string" || bundleName.length === 0) {
    throw new Error(
      `[copy-overlay] overlay manifest has no "overlay" entry: ${overlayManifestPath}`,
    );
  }

  const bundleSrc = join(overlayDist, bundleName);
  if (!existsSync(bundleSrc)) {
    throw new Error(`[copy-overlay] hashed bundle not found: ${bundleSrc}`);
  }

  // Fresh each build: drop stale hashed bundles so old hashes don't pile up.
  await mkdir(publicScDir, { recursive: true });
  for (const entry of await readdir(publicScDir)) {
    if (HASHED_BUNDLE_RE.test(entry)) {
      await rm(join(publicScDir, entry));
    }
  }

  await copyFile(bundleSrc, join(publicScDir, bundleName));

  // The route imports this JSON statically, so the hashed name is bundled into
  // the serverless function (no request-time fs read).
  await writeFile(
    libManifestPath,
    JSON.stringify({ overlay: bundleName }, null, 2) + "\n",
    "utf8",
  );

  console.log(
    `[copy-overlay] published public/sc/${bundleName} (lib/overlay-manifest.json updated)`,
  );
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
