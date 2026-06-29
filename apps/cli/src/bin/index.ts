#!/usr/bin/env node
/**
 * SuperComment local helper CLI.
 *
 * Commands:
 *   - `start` (U4): share the local app behind a stable backend link (proxy +
 *     cloudflared tunnel + injected overlay + outbound channel). Human-facing,
 *     so stdout logging is fine here.
 *   - `mcp` (U12): a local stdio MCP server the developer's Claude Code connects
 *     to. The `mcp` command speaks JSON-RPC over stdout — it must NOT print
 *     anything to stdout itself.
 */
import { runMcpServer } from "../mcp/server.js";
import { runStart } from "../start/index.js";
import { loadProjectBinding } from "../config/binding.js";
import { isTunnelEnabled, TUNNEL_DISABLED_MESSAGE } from "../tunnel-gate.js";
import type { ChannelSupabaseClient } from "../channel/index.js";
import type { AccessMode } from "../exposure-warning.js";

const HELP = `supercomment — team visual feedback for AI-driven development

Usage:
  supercomment <command>

Commands:
  start        Start sharing the local app (proxy + tunnel + overlay)
  mcp          Run the local MCP server over stdio (for Claude Code)
  help         Show this help

supercomment start --port <n> [--access-mode team_only|guest_link]
  Shares http://localhost:<n> behind a stable backend link. Reviewers open the
  link in a browser with nothing to install. Ctrl+C stops sharing.

Register the MCP server with Claude Code (writes .mcp.json):
  claude mcp add supercomment --transport stdio --scope project -- supercomment mcp

The MCP server reads comments via the developer-scoped project binding written
by \`supercomment start\` (U5) at ~/.supercomment/binding.json, or from the
SUPERCOMMENT_SUPABASE_URL / SUPERCOMMENT_TOKEN / SUPERCOMMENT_PREVIEW_ID env
vars.
`;

/**
 * Parse + run `supercomment start`. Parses `--port <n>` (required) and
 * `--access-mode team_only|guest_link` (optional, defaults team-only), loads the
 * project binding, builds an outbound Supabase client, and runs the share.
 */
async function runStartCommand(args: string[]): Promise<number> {
  let port: number | undefined;
  let accessMode: AccessMode = "team-only";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--port" || arg === "-p") {
      port = Number(args[++i]);
    } else if (arg.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
    } else if (arg === "--access-mode") {
      accessMode = normalizeAccessMode(args[++i]);
    } else if (arg.startsWith("--access-mode=")) {
      accessMode = normalizeAccessMode(arg.slice("--access-mode=".length));
    } else {
      process.stderr.write(`start: unknown argument: ${arg}\n`);
      return 1;
    }
  }

  if (port === undefined || !Number.isInteger(port) || port <= 0) {
    process.stderr.write(
      "start: --port <n> is required (the local dev-server port to share).\n",
    );
    return 1;
  }

  const binding = await loadProjectBinding();
  // Supabase requires the project's ANON (publishable) key as the `apikey`; the
  // developer's member JWT goes only in the Authorization bearer so RLS applies
  // the member identity. They are different values — passing the JWT as the
  // apikey yields "Invalid API key".
  const anonKey = process.env.SUPERCOMMENT_ANON_KEY;
  if (!anonKey) {
    process.stderr.write(
      "start: SUPERCOMMENT_ANON_KEY is required (the project's anon/publishable " +
        "key, used as the Supabase apikey). SUPERCOMMENT_TOKEN must be your " +
        "developer member session JWT, not the anon key.\n",
    );
    return 1;
  }
  const client = await buildSupabaseClient(
    binding.supabaseUrl,
    anonKey,
    binding.token,
  );

  await runStart({ port, accessMode, binding, client });
  // runStart resolves once live; keep the process alive until SIGINT cleans up.
  return await new Promise<number>(() => {
    /* run until Ctrl+C */
  });
}

/** Map the CLI's DB-flavored mode names onto the exposure-warning AccessMode. */
function normalizeAccessMode(value: string | undefined): AccessMode {
  if (value === "guest_link" || value === "guest") return "guest";
  if (value === "team_only" || value === "team-only") return "team-only";
  throw new Error(
    `Invalid --access-mode: ${String(value)} (use team_only or guest_link).`,
  );
}

/**
 * VERIFY IN REAL ENV: builds the outbound Supabase client from the binding
 * token. Imported lazily so the unit-tested orchestration (which injects a fake
 * client) never pulls in the SDK, and so a missing dependency surfaces here with
 * an actionable message rather than at module load.
 */
async function buildSupabaseClient(
  url: string,
  anonKey: string,
  memberToken: string,
): Promise<ChannelSupabaseClient> {
  const { createClient } = await import("@supabase/supabase-js");
  // apikey = anon key (required by the gateway); Authorization = member JWT (so
  // RLS / member-only RPCs like register_preview_tunnel see the developer).
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${memberToken}` } },
  });
  return client as unknown as ChannelSupabaseClient;
}

/** Returns an exit code for synchronous commands, or null if handled async. */
async function main(argv: string[]): Promise<number> {
  const [command] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      return 0;

    case "start":
      // Tunnel mode is disabled by default (U10 / R17): the product ships
      // embedded review mode. runStart + all proxy/tunnel/channel/csp code are
      // retained intact (and bug-patched) behind SUPERCOMMENT_ENABLE_TUNNEL, but
      // the dispatch refuses to spawn anything unless the flag is set. (Tests
      // call runStart directly, so they survive this dispatch-level gate.)
      if (!isTunnelEnabled()) {
        process.stdout.write(TUNNEL_DISABLED_MESSAGE + "\n");
        return 0;
      }
      return await runStartCommand(argv.slice(1));

    case "mcp": {
      // The MCP server logs to stderr only and runs until the client
      // disconnects. Do NOT write to stdout here — it carries JSON-RPC.
      try {
        await runMcpServer();
        // runMcpServer resolves once connected; keep the process alive while
        // the transport handles requests. The transport closing will end it.
        return await new Promise<number>(() => {
          /* run until process exit / transport close */
        });
      } catch {
        // runMcpServer already logged the actionable reason to stderr.
        return 1;
      }
    }

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `supercomment: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  },
);
