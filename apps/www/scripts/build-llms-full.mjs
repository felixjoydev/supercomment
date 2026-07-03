// Generates public/llms-full.txt at build time (concatenated docs-style corpus).
// Stub for the initial smoke build; the full generator lands in the SEO phase.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");
mkdirSync(pub, { recursive: true });
writeFileSync(join(pub, "llms-full.txt"), "# SuperComment\n");
console.log("[llms] wrote public/llms-full.txt (stub)");
