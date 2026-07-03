/**
 * Real-environment smoke test for `supercomment start` (U4).
 *
 * Exercises the live pieces the sandbox could never reach: a REAL cloudflared
 * quick tunnel + the REAL U3 proxy injecting the overlay into a REAL app served
 * through that tunnel. Stub registerTunnel (the backend RPC doesn't exist yet)
 * and a fake Supabase client for the channel.
 */
import { runStart } from "../apps/cli/src/start/index.ts";
import type { ChannelSupabaseClient } from "../apps/cli/src/channel/index.ts";
import { readStartConfig, createDemoApp } from "./lib/start-harness.mts";

// Preview id / link secret / Supabase URL come from the environment (or the
// gitignored scripts/.env.local) — never the repo (M2). See scripts/lib/start-harness.mts.
const cfg = readStartConfig();
const ANON_KEY = process.env.SC_ANON ?? "anon-placeholder";

function log(...a: unknown[]) {
  console.log("[smoke]", ...a);
}

async function fetchOnce(url: string, label: string): Promise<string> {
  try {
    const resp = await fetch(url, { headers: { "user-agent": "sc-smoke" } });
    const html = await resp.text();
    log(`${label}: HTTP ${resp.status}, ${html.length} bytes`);
    return resp.status === 200 ? html : "";
  } catch (e) {
    log(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    return "";
  }
}

async function main() {
  const app = await createDemoApp(
    "<!doctype html><html><head><title>Fake Dev App</title></head>" +
      "<body><h1>hello from the dev app</h1></body></html>",
  );
  const appPort = app.port;
  log("fake dev app on", appPort);

  // Pin the front server to a known port so we can hit it directly.
  const FRONT_PORT = 8799;

  const fakeClient = {
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
      select: () => ({
        eq: () => ({
          in: () => ({ order: async () => ({ data: [], error: null }) }),
        }),
      }),
    }),
  } as unknown as ChannelSupabaseClient;

  const running = await runStart({
    port: appPort,
    frontPort: FRONT_PORT,
    accessMode: "guest",
    backendOrigin: "http://localhost:3000",
    binding: {
      supabaseUrl: cfg.supabaseUrl,
      token: ANON_KEY,
      previewId: cfg.previewId,
      linkSecret: cfg.linkSecret,
      anonKey: ANON_KEY,
    } as never,
    client: fakeClient,
    registerTunnel: async ({ tunnelUrl }) => ({ shareUrl: tunnelUrl }),
    heartbeatIntervalMs: 60_000,
  });

  log("tunnelUrl:", running.tunnelUrl);

  // (a) Direct hit on the front server — proves proxy+injection independent of
  //     the tunnel edge being ready.
  const direct = await fetchOnce(
    `http://127.0.0.1:${FRONT_PORT}/`,
    "DIRECT front server",
  );
  const directOverlay = direct.includes("/__supercomment/overlay.js");
  const directBoot = direct.includes("/__supercomment/boot.js");
  const directApp = direct.includes("hello from the dev app");
  log("DIRECT  app/overlay/boot:", directApp, directOverlay, directBoot);

  // (b) Through the tunnel, with patience (cloudflared edge can take ~5-15s).
  let tunnelHtml = "";
  for (let i = 1; i <= 10 && !tunnelHtml; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    tunnelHtml = await fetchOnce(running.tunnelUrl, `TUNNEL attempt ${i}`);
  }
  const tunApp = tunnelHtml.includes("hello from the dev app");
  const tunOverlay = tunnelHtml.includes("/__supercomment/overlay.js");
  const tunBoot = tunnelHtml.includes("/__supercomment/boot.js");

  log("---- RESULTS ----");
  log("DIRECT : app", directApp, "overlay", directOverlay, "boot", directBoot);
  log("TUNNEL : app", tunApp, "overlay", tunOverlay, "boot", tunBoot);

  const directPass = directApp && directOverlay && directBoot;
  const tunnelPass = tunApp && tunOverlay && tunBoot;
  log(
    "VERDICT:",
    directPass && tunnelPass
      ? "FULL PASS — proxy injects AND the public tunnel serves it"
      : directPass
        ? "PARTIAL — injection works locally; tunnel edge unreachable from here"
        : "FAIL — injection broken even on the direct front server",
  );
  if (direct && direct.length < 1500) log("DIRECT html:\n" + direct);

  await running.shutdown();
  app.close();
  process.exit(directPass ? 0 : 1);
}

main().catch((e) => {
  console.error("[smoke] ERROR:", e);
  process.exit(2);
});
