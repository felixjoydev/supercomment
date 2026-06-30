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
import {
  bindingFromEnv,
  loadProjectBinding,
  writeProjectBinding,
  type ProjectBinding,
} from "./binding.js";
import { assertAllowedSupabaseUrl } from "../config/supabase-url.js";
import { findRepoLink, applyRepoLink } from "../config/repo-link.js";
import { decodeJwtExp } from "../auth/identity.js";
import {
  RefreshingTokenSource,
  makeRefreshingFetch,
  type PersistTokens,
} from "./token-source.js";
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
 *
 * Two distinct credentials, and conflating them is the classic failure (R25):
 *   - `apikey`        = the project ANON key (a valid publishable API key). The
 *                       PostgREST gateway authenticates the REQUEST with this;
 *                       a user JWT here is rejected with "Invalid API key".
 *   - `Authorization` = `Bearer <member JWT>`. This is what RLS reads, so the
 *                       developer's member identity (not the anon/guest path)
 *                       governs every row the MCP server can see.
 *
 * The anon key comes from the binding (written by `supercomment login`), falling
 * back to SUPERCOMMENT_ANON_KEY so a hand-rolled env binding still works.
 * Realtime/auth persistence are disabled: the MCP server only does
 * request/response reads + RPC calls.
 */
export async function createSupabaseStore(
  binding: ProjectBinding,
  deps: { persist?: PersistTokens } = {},
): Promise<SupabaseCommentStore> {
  // Never attach the member token to an unexpected host (security review #4).
  assertAllowedSupabaseUrl(binding.supabaseUrl);
  const anonKey = binding.anonKey ?? process.env.SUPERCOMMENT_ANON_KEY;
  if (!anonKey) {
    throw new Error(
      "No Supabase anon key available. Re-run `supercomment login` (it stores " +
        "the anon key in the binding), or set SUPERCOMMENT_ANON_KEY. The member " +
        "JWT in the binding is NOT a valid Supabase apikey.",
    );
  }

  // Keep the access token fresh across a long session: the source refreshes the
  // short-lived token from the binding's refresh token when it nears expiry and
  // persists the rotation back. A custom fetch injects the CURRENT bearer (and
  // the anon apikey) on every request, so freshness does not depend on
  // supabase-js's auth manager.
  const exp = decodeJwtExp(binding.token);
  const source = new RefreshingTokenSource(
    binding.supabaseUrl,
    anonKey,
    {
      accessToken: binding.token,
      ...(binding.refreshToken ? { refreshToken: binding.refreshToken } : {}),
      ...(exp !== undefined ? { expiresAt: exp } : {}),
    },
    { ...(deps.persist ? { persist: deps.persist } : {}) },
  );

  const mod = await importOptional("@supabase/supabase-js");
  const createClient = mod.createClient as (
    url: string,
    key: string,
    opts?: unknown,
  ) => SupabaseLike;
  const client = createClient(binding.supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { apikey: anonKey },
      fetch: makeRefreshingFetch(source, anonKey),
    },
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

  // Per-repo project selection (cwd-aware). An explicit env binding wins; else a
  // committed `supercomment.json` resolved from the working directory overrides
  // which preview's comments this session reads, so different repos map to
  // different projects without a global switch. Credentials stay from the global
  // binding. Best-effort: a link-file problem never blocks the server.
  const envBinding = bindingFromEnv(process.env);
  if (!envBinding) {
    try {
      const found = await findRepoLink(process.cwd());
      if (found) {
        binding = applyRepoLink(binding, found.link);
        logStderr(
          `repo link ${found.path} -> preview ${binding.previewId}` +
            (found.link.project ? ` (${found.link.project})` : ""),
        );
      } else {
        logStderr(
          `no supercomment.json found from ${process.cwd()}; using global ` +
            `binding preview ${binding.previewId} ` +
            "(run `supercomment link` to bind this repo to a project)",
        );
      }
    } catch {
      // best-effort: a repo-link resolution failure must never block the server
    }
  }

  // Persist refreshed tokens back to the binding, but ONLY when it came from a
  // file. An env-provided binding (SUPERCOMMENT_*) has no file to own, so its
  // refresh stays in-memory for the life of the process.
  const persist: PersistTokens | undefined = envBinding
    ? undefined
    : async ({ accessToken, refreshToken }) => {
        await writeProjectBinding({
          ...binding,
          token: accessToken,
          refreshToken,
        });
        logStderr("access token refreshed; binding updated");
      };

  const store = await createSupabaseStore(binding, {
    ...(persist ? { persist } : {}),
  });

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
