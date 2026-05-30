#!/usr/bin/env node
/**
 * SuperComment local helper CLI (stub).
 *
 * Real commands (proxy, tunnel, channel, MCP server) land in later units
 * (U3-U5, U12). For now this prints help and accepts a `start` placeholder so
 * the binary and workspace wiring can be verified.
 */
import { intentSchema } from "@supercomment/shared";

const HELP = `supercomment — team visual feedback for AI-driven development

Usage:
  supercomment <command>

Commands:
  start        Start sharing the local app (not yet implemented)
  help         Show this help

This is a scaffold. Sharing, tunnel, MCP, and channel features arrive in
later implementation units.
`;

function main(argv: string[]): number {
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

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

process.exit(main(process.argv.slice(2)));
