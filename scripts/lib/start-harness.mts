/**
 * Shared config + helpers for the manual "real supercomment start" scripts
 * (run-start-live.mts, smoke-start.mts), which drive the CLI start chain against
 * the live dev DB and a real cloudflared tunnel.
 *
 * The preview id / link secret / Supabase URL used to be hardcoded in those
 * scripts. The link secret is a LIVE guest-write credential, so it must never
 * live in the repo (M2 / CLI-14). They now come from the environment. For local
 * convenience the loader also reads a GITIGNORED `scripts/.env.local`
 * (KEY=VALUE lines); anything already set in the real environment wins.
 *
 * Required vars: SC_PREVIEW_ID, SC_LINK_SECRET, SC_SUPABASE_URL.
 * Optional:      SC_SLUG (run-start-live's resolve_tunnel_for_slug probe).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";

/** Parse a simple KEY=VALUE `.env` file (ignores blank lines + `#` comments). */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/**
 * Load `scripts/.env.local` (gitignored) into process.env WITHOUT overriding
 * anything already present in the real environment. A missing file is a no-op.
 */
export function loadScriptsEnvLocal(): void {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(here, "..", ".env.local"); // scripts/.env.local
    for (const [k, v] of Object.entries(parseEnvFile(readFileSync(envPath, "utf8")))) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* no scripts/.env.local — rely on the real environment */
  }
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Set it in your shell or in the ` +
        `gitignored scripts/.env.local (SC_PREVIEW_ID / SC_LINK_SECRET / ` +
        `SC_SUPABASE_URL). The link secret is a live guest-write credential and ` +
        `is intentionally not committed.`,
    );
  }
  return v;
}

export interface StartConfig {
  previewId: string;
  linkSecret: string;
  supabaseUrl: string;
  /** Preview slug — run-start-live probes resolve_tunnel_for_slug with it. */
  slug?: string;
}

/** Read the start config from the environment (loading scripts/.env.local first). */
export function readStartConfig(): StartConfig {
  loadScriptsEnvLocal();
  return {
    previewId: requireEnv("SC_PREVIEW_ID"),
    linkSecret: requireEnv("SC_LINK_SECRET"),
    supabaseUrl: requireEnv("SC_SUPABASE_URL"),
    slug: process.env.SC_SLUG?.trim() || undefined,
  };
}

/** Read the web anon key from the gitignored apps/web/.env.local. */
export function readAnonKeyFromEnvLocal(): string {
  const env = readFileSync("apps/web/.env.local", "utf8");
  const line = env
    .split("\n")
    .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY="));
  if (!line) throw new Error("anon key not found in apps/web/.env.local");
  return line.slice("NEXT_PUBLIC_SUPABASE_ANON_KEY=".length).trim();
}

/** Spin up a tiny local "dev app" http server on an ephemeral 127.0.0.1 port. */
export async function createDemoApp(
  html: string,
): Promise<{ port: number; close: () => void }> {
  const app = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  const port: number = await new Promise((r) => {
    app.listen(0, "127.0.0.1", () => {
      const a = app.address();
      r(typeof a === "object" && a ? a.port : 0);
    });
  });
  return { port, close: () => app.close() };
}
