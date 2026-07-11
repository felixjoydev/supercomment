/**
 * Pure logic for the dashboard's member-only "prompt to the agent" editor (U4).
 *
 * Kept dependency-free (no DOM, no real Supabase client) so it is unit-testable
 * in a node env — this sandbox's jsdom is broken (see vitest.config.ts), so
 * there is no component-rendering test harness in this app; the codebase's
 * established answer (view.ts, send-to-agent-permission.test.ts) is to extract
 * the RPC-wrapping logic behind a minimal injectable client and test THAT.
 *
 * The component (`agent-prompt.tsx`) is otherwise a thin shell over this module,
 * matching GuestEmail's shape exactly (editing/value/busy/error state machine).
 */

import type { CommentView } from "./types";

/** Raw row shape `set_agent_prompt` / `agent_prompts` return (snake_case, DB-side). */
export interface AgentPromptRow {
  body: string;
  author_display_name: string;
  image_refs?: string[] | null;
}

/**
 * Minimal Supabase surface this module needs — injectable so the exact RPC
 * call args (in particular: the body is NEVER redacted, see redaction.ts) are
 * assertable from a fake client in a node-env test, without a real Supabase
 * client or a DOM.
 *
 * Return type is `PromiseLike` (not `Promise`): the real Supabase client's
 * `.rpc()` returns a thenable `PostgrestFilterBuilder`, not a native Promise,
 * so this is the widest type both the real client and a plain-object fake
 * satisfy structurally.
 */
export interface AgentPromptClient {
  rpc(
    name: "set_agent_prompt",
    args: { p_comment_id: string; p_body: string; p_image_refs: string[] },
  ): PromiseLike<{ data: AgentPromptRow[] | null; error: { message: string } | null }>;
}

/**
 * Render gate for the prompt editor: member-only (R2/R3), never a guest or a
 * non-mutating viewer. Currently just `canMutate`, but kept as a named
 * function (mirroring `canShowSendButton`) so the gate is independently
 * testable and documents intent at the call site.
 */
export function canShowAgentPrompt(canMutate: boolean): boolean {
  return canMutate;
}

/**
 * Derive the CommentView-shaped prompt from `set_agent_prompt`'s SETOF
 * response. Zero rows is the clear path (an empty/whitespace save deleted the
 * row) — indistinguishable from, and handled the same as, "never had one" —
 * per 0043_agent_prompt.sql's header note.
 */
export function promptFromRows(
  rows: AgentPromptRow[] | null | undefined,
): CommentView["privatePrompt"] {
  const row = rows?.[0];
  return row
    ? {
        body: row.body,
        authorDisplayName: row.author_display_name,
        imageRefs: row.image_refs ?? [],
      }
    : null;
}

/**
 * Save (create/edit) or clear (empty/whitespace body) a comment's private
 * agent prompt via `set_agent_prompt` (0043). Thin wrapper — no trimming, no
 * redaction: the body reaches the RPC EXACTLY as authored. The RPC itself
 * decides create/update/delete and does the identity + role checks; this
 * wrapper just shapes the call and the result for the component.
 */
export async function saveAgentPrompt(
  client: AgentPromptClient,
  commentId: string,
  body: string,
  imageRefs: string[] = [],
): Promise<
  { ok: true; prompt: CommentView["privatePrompt"] } | { ok: false; error: string }
> {
  const { data, error } = await client.rpc("set_agent_prompt", {
    p_comment_id: commentId,
    p_body: body,
    p_image_refs: imageRefs,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, prompt: promptFromRows(data) };
}
