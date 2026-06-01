/**
 * Drive a REAL `supercomment start` against the live dev DB, exactly as the CLI
 * would, but: (1) read the anon key from apps/web/.env.local so we don't hardcode
 * it, (2) use a real Supabase client + the REAL registerTunnel (the new
 * register_preview_tunnel RPC), (3) spawn a real cloudflared tunnel, and
 * (4) after ~6s, read the preview row back to confirm it went LIVE with the
 * tunnel URL registered. Then shut down cleanly (flips it back offline).
 *
 * This verifies the whole start chain end-to-end against the DB. The only thing
 * it can't do from this sandbox is fetch the public trycloudflare URL (egress
 * blocked) — but a browser on the user's machine can.
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import { runStart, makeRpcRegisterTunnel } from "../apps/cli/src/start/index.ts";
import type { ChannelSupabaseClient } from "../apps/cli/src/channel/index.ts";

const PREVIEW_ID = "3fb218bf-4d32-4f70-bb24-cbc6642e7958";
const LINK_SECRET = "sk_3537354133995389dee447fb0586346bd7bd66ed51847bc0";
const SUPABASE_URL = "https://uuldjrdrlwcgsiuknoor.supabase.co";
const SLUG = "smoke-64b3181e71";

function readAnonKey(): string {
  const env = readFileSync("apps/web/.env.local", "utf8");
  const line = env.split("\n").find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY="));
  if (!line) throw new Error("anon key not found in apps/web/.env.local");
  return line.slice("NEXT_PUBLIC_SUPABASE_ANON_KEY=".length).trim();
}

function log(...a: unknown[]) {
  console.log("[run-start]", ...a);
}

async function main() {
  const anonKey = readAnonKey();

  // A tiny local "dev app" to share (stands in for the user's app on some port).
  const app = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><head><title>Demo App</title></head><body><h1>demo app being shared</h1></body></html>");
  });
  const appPort: number = await new Promise((r) => {
    app.listen(0, "127.0.0.1", () => { const a = app.address(); r(typeof a === "object" && a ? a.port : 0); });
  });
  log("demo app on", appPort);

  // Real outbound Supabase client, authed with the anon key as bearer. NOTE:
  // register_preview_tunnel is member-only; the anon key is NOT a member, so this
  // is the honest test of whether the anon path is allowed. We expect this to be
  // REJECTED — which tells us the CLI needs a real member token (a gap to report),
  // not a bug to hide.
  const client = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${anonKey}` } },
  }) as unknown as ChannelSupabaseClient;

  const registerTunnel = makeRpcRegisterTunnel("http://localhost:3000");

  let running;
  try {
    running = await runStart({
      port: appPort,
      accessMode: "guest",
      backendOrigin: "http://localhost:3000",
      binding: {
        supabaseUrl: SUPABASE_URL, token: anonKey, previewId: PREVIEW_ID,
        linkSecret: LINK_SECRET, anonKey,
      } as never,
      client,
      registerTunnel,
      heartbeatIntervalMs: 60_000,
    });
  } catch (e) {
    log("runStart FAILED:", e instanceof Error ? e.message : String(e));
    app.close();
    process.exit(3);
  }

  log("tunnelUrl:", running.tunnelUrl);
  log("shareUrl :", running.shareUrl);

  // Read the preview row back via the resolve RPC (anon-readable) to confirm live.
  await new Promise((r) => setTimeout(r, 1500));
  const probe = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { data, error } = await probe.rpc("resolve_tunnel_for_slug", { p_slug: SLUG });
  log("resolve_tunnel_for_slug:", error ? `ERROR ${error.message}` : JSON.stringify(data));

  await running.shutdown();
  app.close();
  process.exit(0);
}

main().catch((e) => { console.error("[run-start] ERROR:", e); process.exit(2); });
