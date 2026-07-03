/**
 * `supercomment login` — browser-based auth handoff that writes the binding.
 *
 * Flow (no hand-copied JWTs, ever):
 *   1. generate a random `state` nonce,
 *   2. start a single-use loopback callback server (callback-server.ts),
 *   3. open the SuperComment web app's `/cli-auth?port=…&state=…` page,
 *   4. the signed-in developer clicks "Authorize CLI"; the page POSTs the
 *      session token + supabase url + anon key back to the loopback server,
 *   5. pick which review link to bind (select.ts), then
 *   6. write `~/.supercomment/binding.json` (0600) carrying the anon key so the
 *      MCP server can read comments immediately.
 *
 * Every collaborator (server, browser opener, Supabase client, binding writer,
 * prompters) is injectable so the orchestration is unit-tested without sockets,
 * a browser, or the network.
 */
import { randomBytes } from "node:crypto";

import { writeProjectBinding, type ProjectBinding } from "../config/binding.js";
import { assertAllowedSupabaseUrl } from "../config/supabase-url.js";
import { decodeJwtEmail, sanitizeForTerminal } from "./identity.js";
import {
  startCallbackServer,
  type ReceivedCreds,
} from "./callback-server.js";
import { defaultOpener, type BrowserOpener } from "./open-browser.js";
import {
  readlinePrompter,
  readlineTextPrompter,
  resolveTarget,
  type Prompter,
  type ReviewTarget,
  type SupabaseQuery,
  type TextPrompter,
} from "./select.js";
import { makeMemberClient } from "../supabase/client.js";
import { trimSlash } from "../lib/url.js";

/** Strip any trailing slash so the origin is clean for URL + CORS use. */
export function normalizeOrigin(url: string): string {
  return trimSlash(url);
}

/** Default per-login nonce: 256 bits, URL-safe. */
function defaultGenState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Build the real Supabase client from the returned creds (anon key + member
 * bearer — see {@link makeMemberClient} for the R25 credential split). Wrapped
 * so unit tests that inject `makeClient` never load the SDK.
 */
async function defaultMakeClient(creds: ReceivedCreds): Promise<SupabaseQuery> {
  return makeMemberClient<SupabaseQuery>(
    creds.supabaseUrl,
    creds.anonKey,
    creds.token,
  );
}

export interface RunLoginOptions {
  /** The SuperComment web app origin to authorize against. */
  appUrl: string;
  /** Don't auto-open a browser (still prints the URL). */
  noBrowser?: boolean;
  /** `--project <id|name>` to skip the interactive picker. */
  projectFlag?: string;
  /** How long to wait for the browser authorization. */
  timeoutMs?: number;

  // --- injectable collaborators (tests) ---
  startServer?: typeof startCallbackServer;
  openBrowser?: BrowserOpener;
  makeClient?: (creds: ReceivedCreds) => Promise<SupabaseQuery>;
  writeBinding?: (binding: ProjectBinding) => Promise<string>;
  prompt?: Prompter;
  promptText?: TextPrompter;
  isTTY?: boolean;
  log?: (line: string) => void;
  genState?: () => string;
}

export interface LoginResult {
  bindingPath: string;
  target: ReviewTarget;
  email?: string;
}

/** Run the login handoff and write the binding. Returns the result for tests. */
export async function runLogin(opts: RunLoginOptions): Promise<LoginResult> {
  const log = opts.log ?? ((l: string) => process.stdout.write(l + "\n"));
  const appUrl = normalizeOrigin(opts.appUrl);
  const genState = opts.genState ?? defaultGenState;
  const startServer = opts.startServer ?? startCallbackServer;
  const openBrowser = opts.openBrowser ?? defaultOpener;
  const makeClient = opts.makeClient ?? defaultMakeClient;
  const writeBinding =
    opts.writeBinding ?? ((b: ProjectBinding) => writeProjectBinding(b));
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY);
  const prompt = opts.prompt ?? readlinePrompter;
  const promptText = opts.promptText ?? readlineTextPrompter;

  const state = genState();
  const server = await startServer({ state, allowOrigin: appUrl });
  const authUrl = `${appUrl}/cli-auth?port=${server.port}&state=${encodeURIComponent(
    state,
  )}`;

  log("");
  log("Opening your browser to authorize SuperComment…");
  log("If it doesn't open, visit this URL:");
  log(`    ${authUrl}`);
  log("");
  if (!opts.noBrowser) {
    await openBrowser(authUrl);
  }

  let creds: ReceivedCreds;
  try {
    creds = await server.waitForCreds(opts.timeoutMs);
  } finally {
    server.close();
  }

  // Never attach the member token to an unexpected host (security review #4).
  assertAllowedSupabaseUrl(creds.supabaseUrl);

  log("Authorized. Selecting a review link…");
  const client = await makeClient(creds);
  const target = await resolveTarget(client, {
    ...(opts.projectFlag ? { projectFlag: opts.projectFlag } : {}),
    prompt,
    promptText,
    isTTY,
    log,
  });

  const binding: ProjectBinding = {
    supabaseUrl: creds.supabaseUrl,
    token: creds.token,
    previewId: target.previewId,
    projectId: target.projectId,
    anonKey: creds.anonKey,
    backendOrigin: appUrl,
    ...(creds.refreshToken ? { refreshToken: creds.refreshToken } : {}),
    ...(target.linkSecret ? { linkSecret: target.linkSecret } : {}),
  };
  const bindingPath = await writeBinding(binding);

  // Identity for display comes from the TOKEN (decoded JWT), never the POST
  // body's `email` field, and is control-char-stripped (security review #2).
  const email = decodeJwtEmail(creds.token);
  log("");
  log(`✔ Logged in${email ? ` as ${sanitizeForTerminal(email)}` : ""}.`);
  log(`  Project:     ${sanitizeForTerminal(target.projectName)}`);
  log(`  Review link: ${target.slug}`);
  log(`  Binding:     ${bindingPath}`);
  log("");
  log("Your AI agent can now read review comments. In Claude Code:");
  log(
    "  • restart Claude Code (or run /mcp) to load the `supercomment` tools, then",
  );
  log('  • ask it to "fix the open comments".');

  return {
    bindingPath,
    target,
    ...(email ? { email } : {}),
  };
}
