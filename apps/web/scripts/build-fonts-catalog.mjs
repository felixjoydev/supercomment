// Prebuild (U7): publish the curated Google-font catalog the editor's font
// picker fetches from OUR origin.
//
// The overlay runs on an arbitrary host page and must never talk to Google to
// LIST fonts (privacy + CSP), so the picker lazy-fetches this small JSON from
// `/sc/fonts-catalog.json` on our own origin instead. The catalog is
// intentionally names + categories + weights ONLY — never URLs. Font BINARIES
// are fetched at selection time straight from the allow-listed
// `fonts.gstatic.com` origin by apps/overlay/src/editor/fonts/load.ts; nothing
// here points at a binary, so a tampered catalog can never redirect a font load.
//
// The weight lists are curated HINTS for the picker's initial weight options;
// the loader parses the family's REAL weights from the css2 response when the
// reviewer selects it, so an approximate hint here is refined on selection.
//
// This is a static, deterministic build step (no network, no Google
// dependency) so Vercel builds are reproducible and offline-safe. To refresh or
// widen the list, edit CURATED below.
//
// Runs automatically before `next build` via the package.json "prebuild" hook.
// For local embedded testing under `next dev`, run it once by hand:
//   node apps/web/scripts/build-fonts-catalog.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const outPath = join(webRoot, "public", "sc", "fonts-catalog.json");

// Common weight sets (kept as shared arrays to keep the source compact).
const W_STD = ["400", "700"];
const W_3 = ["300", "400", "700"];
const W_4 = ["300", "400", "500", "700"];
const W_5 = ["300", "400", "500", "600", "700"];
const W_6 = ["300", "400", "500", "600", "700", "800"];
const W_FULL = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
const W_ONE = ["400"];

// [name, category, weights] — curated ~120 popular families across categories.
// category ∈ sans-serif | serif | display | handwriting | monospace.
const CURATED = [
  // --- Sans-serif (the bulk of real product UI) ---
  ["Inter", "sans-serif", W_FULL],
  ["Roboto", "sans-serif", ["100", "300", "400", "500", "700", "900"]],
  ["Open Sans", "sans-serif", W_6],
  ["Noto Sans", "sans-serif", W_FULL],
  ["Lato", "sans-serif", ["100", "300", "400", "700", "900"]],
  ["Montserrat", "sans-serif", W_FULL],
  ["Poppins", "sans-serif", W_FULL],
  ["Source Sans 3", "sans-serif", W_FULL],
  ["Raleway", "sans-serif", W_FULL],
  ["Nunito", "sans-serif", ["200", "300", "400", "500", "600", "700", "800", "900"]],
  ["Nunito Sans", "sans-serif", W_6],
  ["Work Sans", "sans-serif", W_FULL],
  ["Rubik", "sans-serif", W_5],
  ["DM Sans", "sans-serif", W_5],
  ["Manrope", "sans-serif", ["200", "300", "400", "500", "600", "700", "800"]],
  ["Mulish", "sans-serif", W_FULL],
  ["Karla", "sans-serif", ["200", "300", "400", "500", "600", "700", "800"]],
  ["Quicksand", "sans-serif", ["300", "400", "500", "600", "700"]],
  ["Josefin Sans", "sans-serif", W_5],
  ["Barlow", "sans-serif", W_FULL],
  ["Kanit", "sans-serif", W_FULL],
  ["Heebo", "sans-serif", W_FULL],
  ["PT Sans", "sans-serif", W_STD],
  ["Fira Sans", "sans-serif", W_FULL],
  ["Cabin", "sans-serif", W_5],
  ["Oxygen", "sans-serif", W_3],
  ["Hind", "sans-serif", W_5],
  ["Titillium Web", "sans-serif", ["200", "300", "400", "600", "700", "900"]],
  ["Assistant", "sans-serif", W_6],
  ["Signika", "sans-serif", ["300", "400", "500", "600", "700"]],
  ["Overpass", "sans-serif", W_FULL],
  ["Public Sans", "sans-serif", W_FULL],
  ["Plus Jakarta Sans", "sans-serif", ["200", "300", "400", "500", "600", "700", "800"]],
  ["Figtree", "sans-serif", ["300", "400", "500", "600", "700", "800", "900"]],
  ["Sora", "sans-serif", ["100", "200", "300", "400", "500", "600", "700", "800"]],
  ["Space Grotesk", "sans-serif", ["300", "400", "500", "600", "700"]],
  ["Outfit", "sans-serif", W_FULL],
  ["Lexend", "sans-serif", W_FULL],
  ["Onest", "sans-serif", W_FULL],
  ["Geist", "sans-serif", W_FULL],
  ["Albert Sans", "sans-serif", W_FULL],
  ["Be Vietnam Pro", "sans-serif", W_FULL],
  ["Red Hat Display", "sans-serif", ["300", "400", "500", "600", "700", "800", "900"]],
  ["IBM Plex Sans", "sans-serif", W_6],
  ["Archivo", "sans-serif", W_FULL],
  ["Jost", "sans-serif", W_FULL],
  ["Urbanist", "sans-serif", W_FULL],
  ["Epilogue", "sans-serif", W_FULL],
  ["Schibsted Grotesk", "sans-serif", ["400", "500", "600", "700", "800", "900"]],
  ["Hanken Grotesk", "sans-serif", W_FULL],
  ["Instrument Sans", "sans-serif", ["400", "500", "600", "700"]],
  ["Wix Madefor Text", "sans-serif", ["400", "500", "600", "700", "800"]],
  ["Bricolage Grotesque", "sans-serif", ["200", "300", "400", "500", "600", "700", "800"]],
  ["Anek Latin", "sans-serif", W_FULL],
  ["Gabarito", "sans-serif", ["400", "500", "600", "700", "800", "900"]],
  ["Prompt", "sans-serif", W_FULL],
  ["Mukta", "sans-serif", ["200", "300", "400", "500", "600", "700", "800"]],
  ["Chivo", "sans-serif", W_FULL],
  ["Saira", "sans-serif", W_FULL],

  // --- Serif ---
  ["Playfair Display", "serif", ["400", "500", "600", "700", "800", "900"]],
  ["Merriweather", "serif", ["300", "400", "700", "900"]],
  ["Noto Serif", "serif", W_FULL],
  ["PT Serif", "serif", W_STD],
  ["Lora", "serif", ["400", "500", "600", "700"]],
  ["Roboto Slab", "serif", W_FULL],
  ["Source Serif 4", "serif", W_FULL],
  ["Bitter", "serif", W_FULL],
  ["Crimson Text", "serif", ["400", "600", "700"]],
  ["EB Garamond", "serif", ["400", "500", "600", "700", "800"]],
  ["Libre Baskerville", "serif", W_STD],
  ["Cormorant Garamond", "serif", ["300", "400", "500", "600", "700"]],
  ["Zilla Slab", "serif", W_5],
  ["Domine", "serif", ["400", "500", "600", "700"]],
  ["Frank Ruhl Libre", "serif", ["300", "400", "500", "700", "900"]],
  ["Spectral", "serif", W_6],
  ["Cardo", "serif", W_STD],
  ["Vollkorn", "serif", W_6],
  ["Bodoni Moda", "serif", ["400", "500", "600", "700", "800", "900"]],
  ["DM Serif Display", "serif", W_ONE],
  ["DM Serif Text", "serif", W_ONE],
  ["Newsreader", "serif", W_6],
  ["Fraunces", "serif", W_FULL],
  ["Instrument Serif", "serif", W_ONE],
  ["Marcellus", "serif", W_ONE],
  ["Cormorant", "serif", ["300", "400", "500", "600", "700"]],
  ["Petrona", "serif", W_FULL],
  ["Gelasio", "serif", ["400", "500", "600", "700"]],
  ["Alegreya", "serif", ["400", "500", "700", "800", "900"]],
  ["Noticia Text", "serif", W_STD],

  // --- Display ---
  ["Oswald", "display", ["200", "300", "400", "500", "600", "700"]],
  ["Bebas Neue", "display", W_ONE],
  ["Anton", "display", W_ONE],
  ["Abril Fatface", "display", W_ONE],
  ["Righteous", "display", W_ONE],
  ["Comfortaa", "display", ["300", "400", "500", "600", "700"]],
  ["Lobster", "display", W_ONE],
  ["Pacifico", "display", W_ONE],
  ["Archivo Black", "display", W_ONE],
  ["Fredoka", "display", ["300", "400", "500", "600", "700"]],
  ["Alfa Slab One", "display", W_ONE],
  ["Teko", "display", ["300", "400", "500", "600", "700"]],
  ["Passion One", "display", ["400", "700", "900"]],
  ["Bungee", "display", W_ONE],
  ["Staatliches", "display", W_ONE],
  ["Chakra Petch", "display", ["300", "400", "500", "600", "700"]],
  ["Unbounded", "display", W_FULL],
  ["Bricolage Grotesque Display", "display", ["400", "600", "800"]],
  ["Clash Display", "display", ["400", "500", "600", "700"]],
  ["Syne", "display", ["400", "500", "600", "700", "800"]],
  ["Rampart One", "display", W_ONE],
  ["Titan One", "display", W_ONE],

  // --- Handwriting ---
  ["Caveat", "handwriting", ["400", "500", "600", "700"]],
  ["Dancing Script", "handwriting", ["400", "500", "600", "700"]],
  ["Shadows Into Light", "handwriting", W_ONE],
  ["Satisfy", "handwriting", W_ONE],
  ["Great Vibes", "handwriting", W_ONE],
  ["Sacramento", "handwriting", W_ONE],
  ["Kalam", "handwriting", W_3],
  ["Permanent Marker", "handwriting", W_ONE],
  ["Indie Flower", "handwriting", W_ONE],
  ["Amatic SC", "handwriting", W_STD],

  // --- Monospace ---
  ["Roboto Mono", "monospace", W_5],
  ["Source Code Pro", "monospace", W_FULL],
  ["JetBrains Mono", "monospace", ["100", "200", "300", "400", "500", "600", "700", "800"]],
  ["IBM Plex Mono", "monospace", W_6],
  ["Space Mono", "monospace", W_STD],
  ["Fira Code", "monospace", ["300", "400", "500", "600", "700"]],
  ["Inconsolata", "monospace", ["200", "300", "400", "500", "600", "700", "800", "900"]],
  ["Ubuntu Mono", "monospace", W_STD],
  ["DM Mono", "monospace", ["300", "400", "500"]],
  ["Geist Mono", "monospace", W_FULL],
  ["Overpass Mono", "monospace", ["300", "400", "500", "600", "700"]],
  ["Martian Mono", "monospace", W_FULL],
];

async function main() {
  // Deduplicate defensively and sort within-category by name for a stable file.
  const seen = new Set();
  const families = [];
  for (const [name, category, weights] of CURATED) {
    if (seen.has(name)) continue;
    seen.add(name);
    families.push({ name, category, weights });
  }

  const catalog = { version: 1, families };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(catalog) + "\n", "utf8");
  console.log(
    `[build-fonts-catalog] wrote public/sc/fonts-catalog.json (${families.length} families)`,
  );
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
