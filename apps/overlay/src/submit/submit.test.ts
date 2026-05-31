import { describe, expect, it, vi } from "vitest";

import {
  SupabaseCommentSubmitter,
  submitterFromBootConfig,
  type CreateGuestCommentArgs,
  type RpcCaller,
} from "./index.js";
import type { NewCommentInput } from "@supercomment/shared";

const PAYLOAD: NewCommentInput = {
  previewId: "00000000-0000-0000-0000-000000000001",
  authorDisplayName: "Ada",
  intent: "fix",
  severity: "important",
  note: "Button is misaligned",
  context: {
    selector: "button.cta",
    anchors: [{ type: "id", value: "cta" }],
    url: "https://example.test/dashboard",
    consoleErrors: [],
  },
  fidelity: "live",
};

describe("SupabaseCommentSubmitter.buildArgs", () => {
  it("maps a NewCommentInput onto create_guest_comment positional args", () => {
    const submitter = new SupabaseCommentSubmitter({
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon",
      linkSecret: "secret-123",
      currentPath: () => "/dashboard",
      rpc: async () => ({ number: 1 }),
    });

    const args = submitter.buildArgs(PAYLOAD);
    const expected: CreateGuestCommentArgs = {
      p_link_secret: "secret-123",
      p_path: "/dashboard",
      p_display_name: "Ada",
      p_intent: "fix",
      p_severity: "important",
      p_note: "Button is misaligned",
      p_context: PAYLOAD.context,
      p_fidelity: "live",
    };
    expect(args).toEqual(expected);
  });

  it("defaults fidelity to 'live' when not provided", () => {
    const submitter = new SupabaseCommentSubmitter({
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon",
      linkSecret: "s",
      currentPath: () => "/",
      rpc: async () => ({ number: 1 }),
    });
    const noFidelity = { ...PAYLOAD } as NewCommentInput;
    delete (noFidelity as { fidelity?: string }).fidelity;
    expect(submitter.buildArgs(noFidelity).p_fidelity).toBe("live");
  });
});

describe("SupabaseCommentSubmitter.submit", () => {
  it("calls create_guest_comment and returns the server-allocated number", async () => {
    const rpc = vi.fn<RpcCaller>(async () => ({
      id: "comment-uuid",
      number: 7,
    }));
    const submitter = new SupabaseCommentSubmitter({
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon",
      linkSecret: "secret-123",
      currentPath: () => "/dashboard",
      rpc,
    });

    const result = await submitter.submit(PAYLOAD);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "create_guest_comment",
      expect.objectContaining({
        p_link_secret: "secret-123",
        p_note: "Button is misaligned",
        p_path: "/dashboard",
      }),
    );
    expect(result).toEqual({ ok: true, number: 7, id: "comment-uuid" });
  });

  it("returns ok:false with a message when the RPC throws", async () => {
    const rpc = vi.fn<RpcCaller>(async () => {
      throw new Error("invalid_or_revoked_link");
    });
    const submitter = new SupabaseCommentSubmitter({
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon",
      linkSecret: "secret-123",
      rpc,
    });

    const result = await submitter.submit(PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("invalid_or_revoked_link");
  });

  it("returns ok:false when the server omits a number", async () => {
    const submitter = new SupabaseCommentSubmitter({
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon",
      linkSecret: "secret-123",
      rpc: async () => ({}),
    });
    const result = await submitter.submit(PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.number).toBe(0);
  });

  it("throws when constructed without a link secret", () => {
    expect(
      () =>
        new SupabaseCommentSubmitter({
          supabaseUrl: "https://x.supabase.co",
          supabaseAnonKey: "anon",
          linkSecret: "",
        }),
    ).toThrow(/link secret/i);
  });
});

describe("submitterFromBootConfig", () => {
  it("builds a submitter when the boot config is complete", () => {
    const submitter = submitterFromBootConfig({
      previewId: "p",
      linkSecret: "secret",
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon",
    });
    expect(submitter).toBeInstanceOf(SupabaseCommentSubmitter);
  });

  it("returns undefined when the boot config is incomplete", () => {
    expect(submitterFromBootConfig(undefined)).toBeUndefined();
    expect(
      submitterFromBootConfig({ previewId: "p", linkSecret: "secret" }),
    ).toBeUndefined();
  });
});
