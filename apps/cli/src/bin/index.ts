#!/usr/bin/env node
/**
 * SuperComment local helper CLI.
 *
 * Real commands land across implementation units (proxy U3, tunnel/channel
 * U4/U5). U12 adds the `mcp` subcommand: a local stdio MCP server the
 * developer's Claude Code connects to.
 *
 * NOTE: the `mcp` command speaks JSON-RPC over stdout — it must NOT print
 * anything to stdout itself. All other commands here print human help to
 * stdout, which is fine because they are not the MCP transport.
 */
import { intentSchema } from "@supercomment/shared";
import { runMcpServer } from "../mcp/server.js";

const HELP = `supercomment — team visual feedback for AI-driven development

Usage:
  supercomment <command>

Commands:
  start        Start sharing the local app (not yet implemented)
  mcp          Run the local MCP server over stdio (for Claude Code)
  help         Show this help

Register the MCP server with Claude Code (writes .mcp.json):
  claude mcp add supercomment --transport stdio --scope project -- supercomment mcp

The MCP server reads comments via the developer-scoped project binding written
by \`supercomment start\` (U5) at ~/.supercomment/binding.json, or from the
SUPERCOMMENT_SUPABASE_URL / SUPERCOMMENT_TOKEN / SUPERCOMMENT_PREVIEW_ID env
vars.
`;

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
      process.stdout.write(
        "supercomment start: not yet implemented (placeholder).\n",
      );
      // Touch the shared contract so the workspace dependency is exercised.
      process.stdout.write(
        `shared contract loaded: ${intentSchema.options.join(", ")}\n`,
      );
      return 0;

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
