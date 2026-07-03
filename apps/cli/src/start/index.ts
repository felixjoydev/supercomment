/**
 * `supercomment start` — the one command that shares a running local app (U4).
 *
 * Orchestration (the testable core, all collaborators injectable):
 *   1. Stand up a FRONT http server on a local port that:
 *        - serves the overlay IIFE bundle at a known path
 *          (`/__supercomment/overlay.js`),
 *        - serves a tiny boot-config script at
 *          (`/__supercomment/boot.js`) that sets `window.__SUPERCOMMENT__`
 *          (preview id + link secret + supabase url + anon key) BEFORE the
 *          overlay bundle runs,
 *        - delegates every other request (and WS upgrades) to the U3 reverse
 *          proxy, which injects BOTH <script> tags right after <head>.
 *   2. Spawn a cloudflared quick tunnel pointed at the FRONT server's port.
 *   3. Register the minted tunnel URL with the backend (sets
 *      `previews.current_tunnel_url` + status), via an injectable `registerTunnel`.
 *   4. Start the U5 Channel (heartbeat -> status live; queue consumer).
 *   5. Print the shareable backend link + "reviewers open this, nothing to
 *      install" + the exposure warning.
 *   6. On SIGINT: stop the tunnel, set offline (channel.stop), stop the channel,
 *      and close the front server — in that order — exactly once.
 *
 * Ordering matters and is asserted in tests: proxy/front server up -> tunnel ->
 * register -> channel. We do NOT register a URL we don't have, and we do NOT
 * mark the preview live until everything in front of it is serving.
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Channel, type ChannelSupabaseClient } from "../channel/index.js";
import type { QueueItem } from "../channel/queue.js";
import { loadProjectBinding, type ProjectBinding } from "../config/binding.js";
import { createProxy, type Proxy } from "../proxy/index.js";
import {
  buildExposureWarning,
  type AccessMode,
} from "../exposure-warning.js";
import {
  CloudflaredTunnel,
  type ActiveTunnel,
  type TunnelProvider,
} from "../tunnel/cloudflared.js";
import { asError, errorMessage } from "../lib/errors.js";

/** Known in-page paths the front server owns (never proxied upstream). */
export const OVERLAY_BUNDLE_PATH = "/__supercomment/overlay.js";
export const BOOT_CONFIG_PATH = "/__supercomment/boot.js";

/**
 * What the overlay reads from `window.__SUPERCOMMENT__`. The boot script the
 * front server serves assigns exactly this shape so the injected overlay can
 * construct the real SupabaseCommentSubmitter (guest path).
 */
export interface OverlayBootConfig {
  previewId: string;
  /** The guest link secret the overlay passes to `create_guest_comment`. */
  linkSecret: string;
  /** Anon-key Supabase URL the overlay's client talks to. */
  supabaseUrl: string;
  /** Public anon key (safe to embed; RLS + the RPC are the choke point). */
  supabaseAnonKey: string;
}

/**
 * Registers the live tunnel URL with the backend so the stable
 * `…/s/<slug>` link routes to it. In production this is a Supabase RPC /
 * authenticated POST; injected here so the orchestration is testable and the
 * live call is isolated.
 *
 * Returns the shareable stable URL the developer hands to reviewers.
 */
export type RegisterTunnel = (input: {
  binding: ProjectBinding;
  tunnelUrl: string;
  accessMode: AccessMode;
  client: ChannelSupabaseClient;
}) => Promise<{ shareUrl: string }>;

/**
 * VERIFY IN REAL ENV: the live registration. Calls a security-definer RPC
 * `register_preview_tunnel(p_preview_id, p_tunnel_url, p_access_mode)` that sets
 * `previews.current_tunnel_url`, `access_mode`, marks status live, and returns
 * the slug. The RPC itself is U4-backend's responsibility; this adapter defines
 * the call shape and maps the slug to the shareable `…/s/<slug>` URL. The loop
 * around it (only called once a URL exists; failure surfaces to the dev) is
 * exercised in tests via an injected fake.
 */
export function makeRpcRegisterTunnel(backendOrigin: string): RegisterTunnel {
  return async ({ binding, tunnelUrl, accessMode, client }) => {
    const { data, error } = await client.rpc("register_preview_tunnel", {
      p_preview_id: binding.previewId,
      p_tunnel_url: tunnelUrl,
      p_access_mode: accessMode === "guest" ? "guest_link" : "team_only",
    });
    if (error) {
      throw asError(error, "register_preview_tunnel failed");
    }
    const slug = extractSlug(data);
    if (!slug) {
      throw new Error(
        "register_preview_tunnel returned no slug; cannot build share URL.",
      );
    }
    return { shareUrl: `${trimSlash(backendOrigin)}/s/${slug}` };
  };
}

function extractSlug(data: unknown): string | undefined {
  const row = (Array.isArray(data) ? data[0] : data) as
    | { slug?: unknown }
    | undefined;
  if (row && typeof row.slug === "string" && row.slug.length > 0) {
    return row.slug;
  }
  if (typeof data === "string" && data.length > 0) return data;
  return undefined;
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/** A logger so tests can capture human output without touching real stdout. */
export interface StartLogger {
  log(line: string): void;
  warn(line: string): void;
}

const defaultLogger: StartLogger = {
  log: (line) => process.stdout.write(line + "\n"),
  warn: (line) => process.stderr.write(line + "\n"),
};

/** Reads the overlay bundle bytes. Injectable so tests don't need a build. */
export type ReadOverlayBundle = () => Promise<string>;

/**
 * Locate and read the built overlay IIFE. By default we resolve it relative to
 * this module's compiled location, walking up to the monorepo and into
 * `apps/overlay/dist/overlay.global.js`. Injectable for tests.
 */
export const defaultReadOverlayBundle: ReadOverlayBundle = async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  // Try a few plausible locations so this works from src (tsx) and dist (tsup).
  const candidates = [
    // monorepo: <root>/apps/overlay/dist/overlay.global.js
    join(here, "..", "..", "..", "overlay", "dist", "overlay.global.js"),
    join(here, "..", "..", "..", "..", "overlay", "dist", "overlay.global.js"),
  ];
  for (const path of candidates) {
    try {
      return await readFile(path, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Overlay bundle not found. Build it first: " +
      "`pnpm --filter @supercomment/overlay build`.",
  );
};

export interface RunStartOptions {
  /** The local dev-server port to share (required). */
  port: number;
  /** Access mode; defaults to team-only (the safe default). */
  accessMode?: AccessMode;
  /** Host the front server binds to. Defaults to 127.0.0.1. */
  host?: string;
  /** The local port the front server listens on. Defaults to port+1, else 0. */
  frontPort?: number;
  /** Backend origin used for CSP connect-src + share URL base. */
  backendOrigin?: string;

  // --- Injectable collaborators (tests / real wiring) ---
  binding?: ProjectBinding;
  /** Supabase client built from the binding token (outbound). */
  client?: ChannelSupabaseClient;
  tunnelProvider?: TunnelProvider;
  registerTunnel?: RegisterTunnel;
  readOverlayBundle?: ReadOverlayBundle;
  /** The MCP/agent sink for the queue consumer (Send to Claude). */
  sink?: (item: QueueItem) => Promise<string | void>;
  /** Heartbeat cadence (ms). Forwarded to the U5 Channel. */
  heartbeatIntervalMs?: number;
  logger?: StartLogger;
  /** Process used to register SIGINT (tests pass a fake EventEmitter). */
  signals?: NodeJS.EventEmitter;
  /** Factory for the front http server (tests inject to avoid real sockets). */
  createServer?: (
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ) => http.Server;
}

/** Handle returned by runStart so callers/tests can drive shutdown. */
export interface RunningShare {
  /** The shareable stable URL printed to the developer. */
  shareUrl: string;
  /** The tunnel URL minted by cloudflared. */
  tunnelUrl: string;
  /** Stop everything (idempotent). Mirrors the SIGINT path. */
  shutdown: () => Promise<void>;
}

/**
 * Build the boot-config script bytes. It assigns `window.__SUPERCOMMENT__`
 * synchronously so the deferred overlay bundle sees it on load. The link secret
 * and anon key are public-by-design here (the secret authorizes the guest write
 * RPC; the anon key is public). We JSON-encode to neutralize injection.
 */
export function buildBootScript(config: OverlayBootConfig): string {
  const json = JSON.stringify(config);
  return `window.__SUPERCOMMENT__=Object.assign(window.__SUPERCOMMENT__||{},${json});`;
}

/**
 * Run the share session. Wires proxy -> tunnel -> register -> channel and
 * returns once everything is live (resolves with the running handle). Throws if
 * any step before "live" fails, cleaning up what it already started.
 */
export async function runStart(
  options: RunStartOptions,
): Promise<RunningShare> {
  const {
    port,
    accessMode = "team-only",
    host = "127.0.0.1",
    backendOrigin,
  } = options;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`--port must be a valid TCP port; got ${String(port)}`);
  }

  const logger = options.logger ?? defaultLogger;
  const binding = options.binding ?? (await loadProjectBinding());
  const client = options.client;
  if (!client) {
    // VERIFY IN REAL ENV: the real Supabase client is built from the binding
    // token (outbound). The orchestration + every collaborator below is tested
    // with an injected fake client; we refuse to silently no-op without one.
    throw new Error(
      "runStart requires a Supabase client (built from the project binding).",
    );
  }
  const tunnelProvider = options.tunnelProvider ?? new CloudflaredTunnel();
  const registerTunnel =
    options.registerTunnel ??
    makeRpcRegisterTunnel(backendOrigin ?? deriveBackendOrigin(binding));
  const readOverlayBundle =
    options.readOverlayBundle ?? defaultReadOverlayBundle;
  const sink: (item: QueueItem) => Promise<string | void> =
    options.sink ?? (async () => undefined);
  const signals = options.signals ?? process;
  const createServer =
    options.createServer ?? ((h) => http.createServer(h));

  // --- shutdown bookkeeping ---------------------------------------------------
  let shuttingDown = false;
  let tunnel: ActiveTunnel | undefined;
  let channel: Channel | undefined;
  let frontServer: http.Server | undefined;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log("\nSuperComment: stopping share…");
    // 1. Stop the tunnel first so no new traffic arrives.
    try {
      tunnel?.stop();
    } catch (err) {
      logger.warn(`tunnel stop failed: ${errorMessage(err)}`);
    }
    // 2. Channel.stop() flips status -> offline (once) and halts heartbeat+queue.
    try {
      await channel?.stop();
    } catch (err) {
      logger.warn(`channel stop failed: ${errorMessage(err)}`);
    }
    // 3. Close the front server last.
    if (frontServer) {
      await closeServer(frontServer);
    }
    logger.log("SuperComment: stopped. Preview is offline.");
  };

  try {
    // --- 1. front server (overlay bundle + boot config + U3 proxy) -----------
    const overlayBundle = await readOverlayBundle();
    const bootConfig: OverlayBootConfig = {
      previewId: binding.previewId,
      linkSecret: deriveLinkSecret(binding),
      supabaseUrl: binding.supabaseUrl,
      supabaseAnonKey: deriveAnonKey(binding),
    };
    const bootScript = buildBootScript(bootConfig);

    const proxy: Proxy = createProxy({
      target: `http://${host}:${port}`,
      // Inject the boot config FIRST, then the overlay bundle (defer keeps order
      // by document position regardless). Both live on the front server origin.
      bootScriptUrl: BOOT_CONFIG_PATH,
      overlayScriptUrl: OVERLAY_BUNDLE_PATH,
      ...(backendOrigin ? { backendOrigin } : {}),
    });

    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      const url = req.url ?? "/";
      if (url === OVERLAY_BUNDLE_PATH || url.startsWith(OVERLAY_BUNDLE_PATH + "?")) {
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(overlayBundle);
        return;
      }
      if (url === BOOT_CONFIG_PATH || url.startsWith(BOOT_CONFIG_PATH + "?")) {
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(bootScript);
        return;
      }
      proxy.handleRequest(req, res);
    };

    frontServer = createServer(handler);
    frontServer.on("upgrade", proxy.handleUpgrade);
    const frontPort = await listen(
      frontServer,
      options.frontPort ?? 0,
      host,
    );

    // --- 2. tunnel -----------------------------------------------------------
    tunnel = await tunnelProvider.start(frontPort);
    const tunnelUrl = tunnel.url;

    // --- 3. register with backend -------------------------------------------
    const { shareUrl } = await registerTunnel({
      binding,
      tunnelUrl,
      accessMode,
      client,
    });

    // --- 4. channel (heartbeat -> live; queue consumer) ----------------------
    channel = new Channel({
      binding,
      client,
      sink,
      ...(options.heartbeatIntervalMs
        ? { heartbeatIntervalMs: options.heartbeatIntervalMs }
        : {}),
      onError: (where, err) =>
        logger.warn(`channel ${where}: ${errorMessage(err)}`),
    });
    await channel.start();

    // --- 5. print the shareable link + warning -------------------------------
    logger.log("");
    logger.log(buildExposureWarning({ port, host, accessMode }));
    logger.log("");
    logger.log(`✔ SuperComment is live. Share this link:`);
    logger.log(`    ${shareUrl}`);
    logger.log(
      "  Reviewers just open it in their browser — nothing to install.",
    );
    logger.log("  Press Ctrl+C to stop sharing.");

    // --- 6. SIGINT -> clean shutdown ----------------------------------------
    signals.once("SIGINT", () => {
      void shutdown().then(() => {
        // Only exit the real process; tests inject a fake emitter + no exit.
        if (signals === process) process.exit(0);
      });
    });

    return { shareUrl, tunnelUrl, shutdown };
  } catch (err) {
    // Best-effort cleanup of anything we managed to start before failing.
    await shutdown();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Binding-derived config. The binding (U5) carries supabaseUrl/token/previewId;
// the guest link secret + anon key for the overlay are supplied via env in the
// real flow (U4-backend can also extend the binding later). We read them from
// env with the binding as a fallback so tests can inject a complete binding.
// ---------------------------------------------------------------------------

interface BindingWithExtras extends ProjectBinding {
  linkSecret?: string;
  anonKey?: string;
  backendOrigin?: string;
}

function deriveLinkSecret(binding: ProjectBinding): string {
  const fromEnv = process.env.SUPERCOMMENT_LINK_SECRET;
  const fromBinding = (binding as BindingWithExtras).linkSecret;
  const secret = fromEnv ?? fromBinding;
  if (!secret) {
    throw new Error(
      "No guest link secret available. Set SUPERCOMMENT_LINK_SECRET " +
        "(the preview's link secret) so reviewers can submit comments.",
    );
  }
  return secret;
}

function deriveAnonKey(binding: ProjectBinding): string {
  const fromEnv = process.env.SUPERCOMMENT_ANON_KEY;
  const fromBinding = (binding as BindingWithExtras).anonKey;
  const key = fromEnv ?? fromBinding;
  if (!key) {
    throw new Error(
      "No Supabase anon key available. Set SUPERCOMMENT_ANON_KEY so the " +
        "injected overlay can reach the backend.",
    );
  }
  return key;
}

function deriveBackendOrigin(binding: ProjectBinding): string {
  return (
    process.env.SUPERCOMMENT_BACKEND_ORIGIN ??
    (binding as BindingWithExtras).backendOrigin ??
    "https://app.supercomment.dev"
  );
}

// ---------------------------------------------------------------------------
// small server/util helpers
// ---------------------------------------------------------------------------

function listen(
  server: http.Server,
  port: number,
  host: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve(addr.port);
      } else {
        // Injected fake server without a real address: fall back to requested.
        resolve(port);
      }
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

