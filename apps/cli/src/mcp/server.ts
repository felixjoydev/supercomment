/**
 * SuperComment MCP server (stdio).
 *
 * This is the transport shell that Claude Code spawns and talks to over
 * stdio (JSON-RPC). It:
 *   1. loads the developer-scoped project binding (U5 writes it; U12 reads it),
 *   2. builds a SupabaseCommentStore scoped to the bound preview,
 *   3. registers the SuperComment tools (tools.ts) on an McpServer, and
 *   4. connects a StdioServerTransport.
 *
 * CRITICAL (MCP over stdio): stdout carries the JSON-RPC protocol. ANY write to
 * stdout corrupts the stream. ALL logging here goes to stderr only. Never use
 * console.log (which writes to stdout) anywhere in the MCP code path.
 *
 * The MCP SDK is imported dynamically so the rest of the CLI (proxy, etc.) and
 * the pure tool logic do not hard-require `@modelcontextprotocol/sdk` to build
 * or test. If the SDK is not installed, `runMcpServer` fails with an actionable
 * message instead of breaking unrelated commands.
 *
 * Registration (documented for the developer):
 *   claude mcp add supercomment --transport stdio --scope project \
 *     -- supercomment mcp
 * which writes the server into the project's `.mcp.json`.
 */
import { loadProjectBinding, type ProjectBinding } from "./binding.js";
import { SupabaseCommentStore, type SupabaseLike } from "./store.js";
import { registerTools, type McpServerLike } from "./tools.js";

/** stderr-only logger. Using process.stderr keeps stdout clean for JSON-RPC. */
export function logStderr(message: string): void {
  process.stderr.write(`[supercomment-mcp] ${message}\n`);
}

/**
 * Import a module by a runtime-computed specifier so TypeScript does NOT try to
 * statically resolve it. This keeps `@modelcontextprotocol/sdk` and
 * `@supabase/supabase-js` OPTIONAL at type-check time: the pure tool logic and
 * its tests never touch them, and `tsc --noEmit` passes whether or not they are
 * installed in the sandbox. The real import still happens at runtime.
 */
async function importOptional(specifier: string): Promise<any> {
  // Indirection via a variable prevents TS from treating this as a static
  // import target (no TS2307 when the package is absent).
  const spec = specifier;
  return import(/* @vite-ignore */ spec);
}

const SERVER_NAME = "supercomment";
const SERVER_VERSION = "0.0.0";

/**
 * Build a Supabase client from the binding. Dynamically imports
 * `@supabase/supabase-js` so this module doesn't hard-require it at type time.
 * The developer-scoped token is sent as the Authorization bearer so RLS applies
 * the member identity (R25 — not the guest path). Realtime/auth persistence are
 * disabled: the MCP server only does request/response reads + RPC calls.
 */
export async function createSupabaseStore(
  binding: ProjectBinding,
): Promise<SupabaseCommentStore> {
  const mod = await importOptional("@supabase/supabase-js");
  const createClient = mod.createClient as (
    url: string,
    key: string,
    opts?: unknown,
  ) => SupabaseLike;
  const client = createClient(binding.supabaseUrl, binding.token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${binding.token}` } },
  });
  return new SupabaseCommentStore(client, binding.previewId);
}

/**
 * Boot the stdio MCP server. Dynamically imports the MCP SDK. All status goes
 * to stderr. Resolves when the transport is connected (it then runs until the
 * client disconnects / the process exits).
 */
export async function runMcpServer(): Promise<void> {
  let binding: ProjectBinding;
  try {
    binding = await loadProjectBinding();
  } catch (err) {
    logStderr(
      `cannot start: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
  logStderr(
    `binding loaded (preview ${binding.previewId}); connecting to Supabase`,
  );

  const store = await createSupabaseStore(binding);

  // Dynamic import keeps the SDK optional for build/test of unrelated code.
  // VERIFY IN REAL ENV: the live Claude-Code <-> stdio JSON-RPC handshake and a
  // real Supabase round trip are exercised only when the SDK is installed and a
  // real binding exists; they are not covered by the in-memory unit tests.
  let McpServer: new (info: { name: string; version: string }) => McpServerLike & {
    connect(transport: unknown): Promise<void>;
  };
  let StdioServerTransport: new () => unknown;
  try {
    const mcpMod = await importOptional(
      "@modelcontextprotocol/sdk/server/mcp.js",
    );
    const stdioMod = await importOptional(
      "@modelcontextprotocol/sdk/server/stdio.js",
    );
    McpServer = mcpMod.McpServer;
    StdioServerTransport = stdioMod.StdioServerTransport;
  } catch (err) {
    logStderr(
      `@modelcontextprotocol/sdk not available: ${
        err instanceof Error ? err.message : String(err)
      }. Install it to run the MCP server.`,
    );
    throw err;
  }

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerTools(server, store);
  logStderr("tools registered: list_open_comments, get_all_open, get_comment, resolve_comment, dismiss_comment");

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logStderr("stdio transport connected; awaiting requests");
}
