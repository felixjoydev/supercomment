import { describe, it, expect, vi } from "vitest";

import { containsSecret } from "@supercomment/shared";
import {
  canShowAgentPrompt,
  promptFromRows,
  saveAgentPrompt,
  type AgentPromptClient,
} from "../lib/comments/agent-prompt";

/**
 * U4 — dashboard "prompt to the agent" editor. Node env, pure logic + a
 * mocked Supabase-shaped client, mirroring the fakeSupabase pattern in
 * send-to-agent-permission.test.ts. There is no component-rendering harness in
 * this app (jsdom is broken here, see vitest.config.ts), so the RPC-wrapping
 * logic the component calls is extracted and tested directly instead.
 */

describe("agent prompt editor visibility (canShowAgentPrompt)", () => {
  it("shows for a member (canMutate)", () => {
    expect(canShowAgentPrompt(true)).toBe(true);
  });

  it("never shows for a guest / non-mutating viewer (R2)", () => {
    expect(canShowAgentPrompt(false)).toBe(false);
  });
});

describe("promptFromRows — set_agent_prompt SETOF derivation", () => {
  it("derives {body, authorDisplayName} from a single returned row", () => {
    expect(
      promptFromRows([{ body: "Use dark mode for this button", author_display_name: "Ada" }]),
    ).toEqual({ body: "Use dark mode for this button", authorDisplayName: "Ada" });
  });

  it("is null for zero rows — the clear path, same as 'never had one'", () => {
    expect(promptFromRows([])).toBeNull();
    expect(promptFromRows(null)).toBeNull();
    expect(promptFromRows(undefined)).toBeNull();
  });
});

function fakeClient(result: {
  data?: unknown;
  error?: { message: string } | null;
}): AgentPromptClient & { rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(async () => ({
    data: (result.data ?? null) as never,
    error: result.error ?? null,
  }));
  return { rpc };
}

describe("saveAgentPrompt — set_agent_prompt wrapper", () => {
  it("happy path: saves a prompt and returns it with attribution", async () => {
    const client = fakeClient({
      data: [{ body: "Fix the header spacing", author_display_name: "Priya" }],
    });
    const result = await saveAgentPrompt(client, "c1", "Fix the header spacing");

    expect(client.rpc).toHaveBeenCalledWith("set_agent_prompt", {
      p_comment_id: "c1",
      p_body: "Fix the header spacing",
    });
    expect(result).toEqual({
      ok: true,
      prompt: { body: "Fix the header spacing", authorDisplayName: "Priya" },
    });
  });

  it("saving an empty body clears the prompt (zero rows back -> null)", async () => {
    const client = fakeClient({ data: [] });
    const result = await saveAgentPrompt(client, "c1", "");

    expect(client.rpc).toHaveBeenCalledWith("set_agent_prompt", {
      p_comment_id: "c1",
      p_body: "",
    });
    expect(result).toEqual({ ok: true, prompt: null });
  });

  it("a secret-shaped body is flagged by containsSecret but saved to the RPC UNCHANGED", async () => {
    const secret = "sk-" + "a".repeat(25);
    const client = fakeClient({
      data: [{ body: secret, author_display_name: "Ada" }],
    });

    expect(containsSecret(secret)).toBe(true); // sanity: this really is secret-shaped

    const result = await saveAgentPrompt(client, "c1", secret);

    // The exact original body reaches the RPC — never redacted.
    expect(client.rpc).toHaveBeenCalledWith("set_agent_prompt", {
      p_comment_id: "c1",
      p_body: secret,
    });
    expect(result).toEqual({ ok: true, prompt: { body: secret, authorDisplayName: "Ada" } });
  });

  it("surfaces an RPC error without throwing", async () => {
    const client = fakeClient({ error: { message: "not_authorized" } });
    const result = await saveAgentPrompt(client, "c1", "hi");
    expect(result).toEqual({ ok: false, error: "not_authorized" });
  });
});
