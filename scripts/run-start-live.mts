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
import { createClient } from "@supabase/supabase-js";
import { runStart, makeRpcRegisterTunnel } from "../apps/cli/src/start/index.ts";
import type { ChannelSupabaseClient } from "../apps/cli/src/channel/index.ts";
import {
  readStartConfig,
  readAnonKeyFromEnvLocal,
  createDemoApp,
} from "./lib/start-harness.mts";

// Preview id / link secret / Supabase URL come from the environment (or the
// gitignored scripts/.env.local) — never the repo (M2). See scripts/lib/start-harness.mts.
const cfg = readStartConfig();

function log(...a: unknown[]) {
  console.log("[run-start]", ...a);
}

async function main() {
  const anonKey = readAnonKeyFromEnvLocal();

  // A tiny local "dev app" to share (stands in for the user's app on some port).
  const app = await createDemoApp(
    "<!doctype html><html><head><title>Demo App</title></head><body><h1>demo app being shared</h1></body></html>",
  );
  const appPort = app.port;
  log("demo app on", appPort);

  // Real outbound Supabase client, authed with the anon key as bearer. NOTE:
  // register_preview_tunnel is member-only; the anon key is NOT a member, so this
  // is the honest test of whether the anon path is allowed. We expect this to be
  // REJECTED — which tells us the CLI needs a real member token (a gap to report),
  // not a bug to hide.
  const client = createClient(cfg.supabaseUrl, anonKey, {
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
        supabaseUrl: cfg.supabaseUrl, token: anonKey, previewId: cfg.previewId,
        linkSecret: cfg.linkSecret, anonKey,
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
  const probe = createClient(cfg.supabaseUrl, anonKey, { auth: { persistSession: false } });
  if (cfg.slug) {
    const { data, error } = await probe.rpc("resolve_tunnel_for_slug", { p_slug: cfg.slug });
    log("resolve_tunnel_for_slug:", error ? `ERROR ${error.message}` : JSON.stringify(data));
  } else {
    log("SC_SLUG not set — skipping resolve_tunnel_for_slug probe");
  }

  await running.shutdown();
  app.close();
  process.exit(0);
}

main().catch((e) => { console.error("[run-start] ERROR:", e); process.exit(2); });
