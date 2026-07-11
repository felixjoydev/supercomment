/**
 * U10 real-env gates for the agent-handoff-context-layers feature.
 *
 * Drives the REAL MCP store/tools/repo-discovery modules against the LIVE
 * Supabase project, authenticated as a real signed-in member (password grant,
 * per docs memory `running-setup`), to exercise what the in-memory unit tests
 * cannot: RLS, the real signed-URL round trip, and the real send/prompt RPCs.
 *
 * Fixtures used (created directly via SQL ahead of this run, see the U10
 * runbook at docs/verification/2026-07-07-agent-handoff-context-layers-real-env-gates.md):
 *   - comment #37 (guest-authored) in preview 89c36382-... with a real
 *     `captures` reference-image path — Gates 1 & 2.
 *   - comment #38 (member-authored) in the same preview — Gates 3 & 4.
 *
 * Run from the REPO ROOT (unlike the other scratch harnesses, this one does
 * NOT need `cd apps/cli` — see the SUPABASE_JS_ENTRY note below for why):
 *   SC_MEMBER_TOKEN_PATH=<path> arch -arm64 node_modules/.bin/tsx scripts/verify-agent-handoff-live.mts
 *

 * Requires a fresh member access token (password grant, see running-setup
 * memory) at the path in env var SC_MEMBER_TOKEN_PATH — a JSON file shaped
 * like the raw Supabase token response (`{ "access_token": "...", ... }`).
 * Kept OUTSIDE the repo (the session scratchpad) since it's a live bearer
 * token, never written under scripts/. Reads the anon key from
 * apps/web/.env.local like the other scratch harnesses.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { readAnonKeyFromEnvLocal } from "./lib/start-harness.mts";

// Resolve relative to THIS file's own location (not a hardcoded absolute path
// tied to one developer's machine — matches scripts/lib/start-harness.mts'
// established convention), so this script works for any contributor/CI.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_RESOLVED = resolve(SCRIPT_DIR, "..");

// `@supabase/supabase-js` is a dependency of apps/cli (not hoisted to the repo
// root — see docs memory `sandbox-arch-and-browser`), and this script lives
// under repo-root `scripts/`, so a bare `import "@supabase/supabase-js"`
// cannot resolve via Node's ESM package-resolution algorithm (it walks up
// from THIS file's directory, never into apps/cli/node_modules). Importing
// the package's real ESM entry file by an absolute file:// URL sidesteps
// bare-specifier resolution entirely — this is the exact same package/build
// the CLI itself uses at runtime, not a stand-in.
const SUPABASE_JS_ENTRY = pathToFileURL(
  resolve(REPO_ROOT_RESOLVED, "apps/cli/node_modules/@supabase/supabase-js/dist/index.mjs"),
).href;
const { createClient } = (await import(SUPABASE_JS_ENTRY)) as {
  createClient: typeof import("@supabase/supabase-js").createClient;
};

import { SupabaseCommentStore, type SupabaseLike } from "../apps/cli/src/mcp/store.ts";
import {
  handleGetComment,
  registerTools,
  STANDING_GUIDANCE,
  type McpServerLike,
  type McpToolResult,
} from "../apps/cli/src/mcp/tools.ts";
import {
  buildRepoDiscoverySeam,
  computeRepoDiscovery,
  DEGRADED_RESULT,
} from "../apps/cli/src/mcp/repo-discovery.ts";

const SUPABASE_URL = "https://uuldjrdrlwcgsiuknoor.supabase.co";
const PREVIEW_ID = "89c36382-8c31-445d-82ff-c265b0193014"; // "Personal website" (dev account)
const OTHER_REAL_PREVIEW_ID = "3fb218bf-4d32-4f70-bb24-cbc6642e7958"; // smoke preview, different project

const GUEST_COMMENT_ID = "2eff152c-3168-489d-a43b-17ee94921fed"; // #37
const GUEST_COMMENT_NUMBER = 37;
const MEMBER_COMMENT_ID = "f90bbe87-bef7-4dd6-b047-c9687a58ab36"; // #38
const MEMBER_COMMENT_NUMBER = 38;

// Repo root for discovery — resolved from this script's own location (not
// process.cwd(), which the caller may invoke from a different directory).
const REPO_ROOT = REPO_ROOT_RESOLVED;

let failures = 0;
function check(label: string, pass: boolean, evidence: string): void {
  const mark = pass ? "PASS" : "FAIL";
  if (!pass) failures++;
  console.log(`[${mark}] ${label} :: ${evidence}`);
}

function readMemberAccessToken(): string {
  const path = process.env.SC_MEMBER_TOKEN_PATH;
  if (!path) throw new Error("Set SC_MEMBER_TOKEN_PATH to a JSON file with an access_token field.");
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as { access_token?: string };
  if (!parsed.access_token) throw new Error(`no access_token in ${path}`);
  return parsed.access_token;
}

async function main() {
  const anonKey = readAnonKeyFromEnvLocal();
  const accessToken = readMemberAccessToken();

  const client = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` } },
  }) as unknown as SupabaseLike;

  const store = new SupabaseCommentStore(client, PREVIEW_ID);

  // -------------------------------------------------------------------------
  // Gate 2 step 1 — getComment BEFORE any confirm: guest reference stripped.
  //
  // NOTE: stripping is a tools.ts-layer concern (`forAgent`), not the store's
  // — the store only decides whether it's worth RESOLVING a raster
  // (`shouldResolveRaster`) and otherwise passes the raw stored value through
  // unchanged (see store.ts's `resolveRasters` doc comment). So this must go
  // through `handleGetComment` (the actual MCP handler), not raw
  // `store.getComment()`, to observe what the agent would really see.
  // -------------------------------------------------------------------------
  const beforeConfirmOut = await handleGetComment(store, { number: GUEST_COMMENT_NUMBER });
  const beforeConfirmComment = beforeConfirmOut.comment;
  const strippedBefore =
    !!beforeConfirmComment &&
    beforeConfirmComment.context?.referenceImages === undefined &&
    beforeConfirmComment.context?.screenshot === undefined;
  check(
    "Gate 2.1 (unconfirmed guest reference stripped)",
    strippedBefore,
    `context keys=${JSON.stringify(Object.keys(beforeConfirmComment?.context ?? {}))}`,
  );

  // -------------------------------------------------------------------------
  // Gate 1 step 2 / Gate 2 step 2 — confirm the send (member, can_send_to_agent=true).
  // -------------------------------------------------------------------------
  const anySb = client as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    from: (t: string) => any;
  };
  const sendRes = await anySb.rpc("send_comment_to_agent", {
    p_comment_id: GUEST_COMMENT_ID,
    p_confirm_guest: true,
  });
  check(
    "Gate 1.2/2.2 (confirmed guest send succeeds)",
    !sendRes.error,
    sendRes.error ? `error=${JSON.stringify(sendRes.error)}` : `queue row(s)=${JSON.stringify(sendRes.data)}`,
  );

  // -------------------------------------------------------------------------
  // Gate 1 step 3 / Gate 2 step 3 — getComment AFTER confirm: resolves to a signed URL.
  // -------------------------------------------------------------------------
  const afterConfirm = await store.getComment(GUEST_COMMENT_NUMBER);
  const resolvedRef = afterConfirm?.context?.referenceImages?.[0];
  const isSignedUrl = typeof resolvedRef === "string" && resolvedRef.startsWith("https://");
  check(
    "Gate 1.3/2.3 (confirmed guest reference resolves to signed URL)",
    isSignedUrl,
    `resolved=${typeof resolvedRef === "string" ? resolvedRef.slice(0, 90) + "..." : String(resolvedRef)}`,
  );

  // -------------------------------------------------------------------------
  // Gate 1 step 4 — fetch the signed URL directly: real HTTP 200 image/*.
  // -------------------------------------------------------------------------
  let fetchOk = false;
  let fetchEvidence = "not attempted (no signed URL)";
  if (isSignedUrl) {
    const resp = await fetch(resolvedRef as string);
    const contentType = resp.headers.get("content-type") ?? "";
    fetchOk = resp.status === 200 && contentType.startsWith("image/");
    fetchEvidence = `status=${resp.status} content-type=${contentType}`;
  }
  check("Gate 1.4 (signed URL fetch returns 200 image/*)", fetchOk, fetchEvidence);

  // -------------------------------------------------------------------------
  // Gate 3 — per-send prompt snapshot fidelity (fresh cycle, member comment).
  // -------------------------------------------------------------------------
  const distinctivePrompt = `U10-GATE3-DISTINCTIVE-PROMPT-${Date.now()}`;
  const setPromptRes = await anySb.rpc("set_agent_prompt", {
    p_comment_id: MEMBER_COMMENT_ID,
    p_body: distinctivePrompt,
  });
  check(
    "Gate 3 pre-step (set_agent_prompt succeeds)",
    !setPromptRes.error,
    setPromptRes.error ? `error=${JSON.stringify(setPromptRes.error)}` : "ok",
  );

  const sendRes2 = await anySb.rpc("send_comment_to_agent", {
    p_comment_id: MEMBER_COMMENT_ID,
    p_confirm_guest: false,
  });
  check(
    "Gate 3 pre-step (send_comment_to_agent succeeds for fresh member cycle)",
    !sendRes2.error,
    sendRes2.error ? `error=${JSON.stringify(sendRes2.error)}` : `queue row(s)=${JSON.stringify(sendRes2.data)}`,
  );

  const { data: queueRow, error: queueErr } = await anySb
    .from("comment_queue")
    .select("prompt_snapshot, prompt_snapshot_author")
    .eq("comment_id", MEMBER_COMMENT_ID)
    .maybeSingle();
  const snapshotMatches = !queueErr && queueRow?.prompt_snapshot === distinctivePrompt;
  check(
    "Gate 3 (prompt_snapshot exactly equals live prompt at send time)",
    snapshotMatches,
    `expected=${JSON.stringify(distinctivePrompt)} actual=${JSON.stringify(queueRow?.prompt_snapshot)}`,
  );

  // -------------------------------------------------------------------------
  // Gate 4 — standing guidance + maturity discovery against THIS real repo.
  // -------------------------------------------------------------------------
  const realDiscovery = await computeRepoDiscovery(REPO_ROOT);
  const gate4a =
    realDiscovery.governanceDocs.length === 0 && realDiscovery.maturity === "thin";
  check(
    "Gate 4a (computeRepoDiscovery on real repo root -> governanceDocs:[] maturity:thin)",
    gate4a,
    `result=${JSON.stringify(realDiscovery)}`,
  );

  const discoverySeam = await buildRepoDiscoverySeam({
    repoRoot: REPO_ROOT,
    anchoredPreviewId: PREVIEW_ID,
  });

  const registered = new Map<
    string,
    { description?: string; handler: (args: Record<string, unknown>) => Promise<McpToolResult> }
  >();
  const fakeServer: McpServerLike = {
    registerTool(name, config, handler) {
      registered.set(name, { description: config.description, handler });
    },
  };
  registerTools(fakeServer, store, discoverySeam);

  const getCommentDescr = registered.get("get_comment")?.description ?? "";
  const descrHasStandingGuidance = getCommentDescr.includes(STANDING_GUIDANCE);
  check(
    "Gate 4b (get_comment tool description carries STANDING_GUIDANCE)",
    descrHasStandingGuidance,
    `description length=${getCommentDescr.length}, contains=${descrHasStandingGuidance}`,
  );

  const getCommentOut = await registered.get("get_comment")!.handler({
    number: MEMBER_COMMENT_NUMBER,
  });
  // designGrounding rides the OUTPUT ENVELOPE (sibling of `comment`), not
  // nested inside the comment object — see attachDesignGrounding in tools.ts.
  const gcPayload = getCommentOut.structuredContent as {
    comment?: unknown;
    designGrounding?: { maturity?: string };
  };
  const maturityIsThin = gcPayload.designGrounding?.maturity === "thin";
  check(
    "Gate 4c (handleGetComment via registerTools -> designGrounding.maturity === 'thin')",
    maturityIsThin,
    `designGrounding=${JSON.stringify(gcPayload.designGrounding)}`,
  );

  // -------------------------------------------------------------------------
  // Gate 5 — use_project-style switch to a differently-linked preview degrades.
  // -------------------------------------------------------------------------
  const switched = discoverySeam.discover(OTHER_REAL_PREVIEW_ID);
  const degradesCorrectly =
    switched.governanceDocs.length === DEGRADED_RESULT.governanceDocs.length &&
    switched.maturity === DEGRADED_RESULT.maturity;
  check(
    "Gate 5 (discover() on a different real previewId degrades to DEGRADED_RESULT)",
    degradesCorrectly,
    `result=${JSON.stringify(switched)} (expected ${JSON.stringify(DEGRADED_RESULT)})`,
  );

  console.log("\n--- summary ---");
  console.log(failures === 0 ? "ALL GATES PASS" : `${failures} GATE(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[verify-agent-handoff-live] FATAL:", e);
  process.exit(2);
});
