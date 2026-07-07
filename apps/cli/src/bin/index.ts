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
import { runLogin } from "../auth/login.js";
import { runInit } from "../auth/init.js";
import { runLink } from "../auth/link.js";
import { runLogout } from "../auth/logout.js";
import { loadProjectBinding } from "../config/binding.js";
import { isTunnelEnabled, TUNNEL_DISABLED_MESSAGE } from "../tunnel-gate.js";
import type { ChannelSupabaseClient } from "../channel/index.js";
import type { AccessMode } from "../exposure-warning.js";

/**
 * Default SuperComment web host to authorize against. The deployed production
 * host so a freshly `npm i`-d user's `supercomment login` works with no config.
 * Override with `--app-url` (or SUPERCOMMENT_APP_URL) for local dev
 * (http://localhost:3000) or a custom domain.
 */
const DEFAULT_APP_URL =
  process.env.SUPERCOMMENT_APP_URL ?? "https://supercomment.vercel.app";

const HELP = `supercomment — team visual feedback for AI-driven development

Usage:
  supercomment <command>

Commands:
  login        Authorize this machine in the browser and bind a review link
  link         Bind THIS repo to a project (writes supercomment.json)
  init         Re-select the global default project (machine-wide)
  logout       Remove the local binding
  mcp          Run the local MCP server over stdio (for Claude Code)
  start        Share a local app (legacy tunnel mode; off by default)
  help         Show this help

Typical setup
  1) supercomment login          (once per machine — authorizes + stores creds)
       Opens your browser; click "Authorize CLI".
       Writes ~/.supercomment/binding.json (0600, carries the anon key).
       Flags:
         --app-url <url>      SuperComment host to authorize against
                              (default \$SUPERCOMMENT_APP_URL or https://supercomment.vercel.app;
                               use http://localhost:3000 for local dev)
         --project <name|id>  also set the global default project
         --no-browser         print the URL instead of opening a browser
  2) Register the MCP with Claude Code for ALL workspaces:
       claude mcp add supercomment --scope user --transport stdio -- supercomment mcp
  3) In each repo:  supercomment link
       Binds THIS repo to a project (auto-detects from the repo/folder name; or
       pass --project <name|id>). Writes supercomment.json — COMMIT it so your
       teammates' agents read the same project automatically.
  4) Restart Claude Code (or run /mcp), then ask it to "fix the open comments".

The MCP reads comments for the repo's linked project (supercomment.json,
resolved from the working directory), falling back to the global default from
\`supercomment login\`/\`init\` when a repo has no link.

The MCP server reads comments through the binding written by \`supercomment
login\`. You can also point it at a review link directly via the
SUPERCOMMENT_SUPABASE_URL / SUPERCOMMENT_TOKEN / SUPERCOMMENT_ANON_KEY /
SUPERCOMMENT_PREVIEW_ID env vars.

supercomment start --port <n> [--access-mode team_only|guest_link]
  Legacy tunnel share (disabled unless SUPERCOMMENT_ENABLE_TUNNEL=1).
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

/** Parse + run `supercomment login` (browser auth handoff → binding). */
async function runLoginCommand(args: string[]): Promise<number> {
  let appUrl = DEFAULT_APP_URL;
  let noBrowser = false;
  let projectFlag: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--app-url") appUrl = args[++i] ?? appUrl;
    else if (arg.startsWith("--app-url=")) appUrl = arg.slice("--app-url=".length);
    else if (arg === "--no-browser") noBrowser = true;
    else if (arg === "--project") projectFlag = args[++i];
    else if (arg.startsWith("--project="))
      projectFlag = arg.slice("--project=".length);
    else {
      process.stderr.write(`login: unknown argument: ${arg}\n`);
      return 1;
    }
  }
  try {
    await runLogin({ appUrl, noBrowser, ...(projectFlag ? { projectFlag } : {}) });
    return 0;
  } catch (err) {
    process.stderr.write(`login failed: ${errText(err)}\n`);
    return 1;
  }
}

/** Parse + run `supercomment init` (re-select the bound review link). */
async function runInitCommand(args: string[]): Promise<number> {
  let projectFlag: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--project") projectFlag = args[++i];
    else if (arg.startsWith("--project="))
      projectFlag = arg.slice("--project=".length);
    else {
      process.stderr.write(`init: unknown argument: ${arg}\n`);
      return 1;
    }
  }
  try {
    await runInit({ ...(projectFlag ? { projectFlag } : {}) });
    return 0;
  } catch (err) {
    process.stderr.write(`init failed: ${errText(err)}\n`);
    return 1;
  }
}

/** Parse + run `supercomment link` (bind THIS repo to a project). */
async function runLinkCommand(args: string[]): Promise<number> {
  let projectFlag: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--project") projectFlag = args[++i];
    else if (arg.startsWith("--project="))
      projectFlag = arg.slice("--project=".length);
    else {
      process.stderr.write(`link: unknown argument: ${arg}\n`);
      return 1;
    }
  }
  try {
    await runLink({ ...(projectFlag ? { projectFlag } : {}) });
    return 0;
  } catch (err) {
    process.stderr.write(`link failed: ${errText(err)}\n`);
    return 1;
  }
}

/** Run `supercomment logout` (remove the local binding). */
async function runLogoutCommand(): Promise<number> {
  try {
    await runLogout();
    return 0;
  } catch (err) {
    process.stderr.write(`logout failed: ${errText(err)}\n`);
    return 1;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

    case "login":
      return await runLoginCommand(argv.slice(1));

    case "init":
      return await runInitCommand(argv.slice(1));

    case "link":
      return await runLinkCommand(argv.slice(1));

    case "logout":
      return await runLogoutCommand();

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
