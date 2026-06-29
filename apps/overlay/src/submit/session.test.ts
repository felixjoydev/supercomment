import { describe, expect, it, vi } from "vitest";

import {
  SessionCommentSubmitter,
  type CreateReviewCommentArgs,
  type SessionRpcCaller,
} from "./session.js";
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

const BASE = {
  supabaseUrl: "https://x.supabase.co",
  supabaseAnonKey: "anon",
  previewId: "00000000-0000-0000-0000-000000000123",
};

describe("SessionCommentSubmitter.buildArgs", () => {
  it("maps a NewCommentInput onto create_review_comment args (no secret/name/path)", () => {
    const submitter = new SessionCommentSubmitter({
      ...BASE,
      getAccessToken: () => "jwt",
      rpc: async () => ({ number: 1 }),
    });

    const args = submitter.buildArgs(PAYLOAD);
    const expected: CreateReviewCommentArgs = {
      p_preview_id: BASE.previewId,
      p_intent: "fix",
      p_severity: "important",
      p_note: "Button is misaligned",
      p_context: PAYLOAD.context,
      p_fidelity: "live",
    };
    expect(args).toEqual(expected);
    // The session's previewId wins over the payload's (server-scoped).
    expect(args.p_preview_id).toBe(BASE.previewId);
    // No link secret / display name / path keys leak into the args.
    expect(Object.keys(args)).not.toContain("p_link_secret");
    expect(Object.keys(args)).not.toContain("p_display_name");
  });

  it("defaults fidelity to 'live' when not provided", () => {
    const submitter = new SessionCommentSubmitter({
      ...BASE,
      getAccessToken: () => "jwt",
      rpc: async () => ({ number: 1 }),
    });
    const noFidelity = { ...PAYLOAD } as NewCommentInput;
    delete (noFidelity as { fidelity?: string }).fidelity;
    expect(submitter.buildArgs(noFidelity).p_fidelity).toBe("live");
  });
});

describe("SessionCommentSubmitter.submit", () => {
  it("calls create_review_comment with the current access token and returns the number", async () => {
    const rpc = vi.fn<SessionRpcCaller>(async () => ({
      id: "comment-uuid",
      number: 7,
    }));
    const submitter = new SessionCommentSubmitter({
      ...BASE,
      getAccessToken: () => "access-jwt",
      rpc,
    });

    const result = await submitter.submit(PAYLOAD);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "create_review_comment",
      expect.objectContaining({
        p_preview_id: BASE.previewId,
        p_note: "Button is misaligned",
      }),
      "access-jwt",
    );
    expect(result).toEqual({ ok: true, number: 7, id: "comment-uuid" });
  });

  it("awaits an async access-token provider (refresh-before-write)", async () => {
    const getAccessToken = vi.fn(async () => "refreshed-jwt");
    const rpc = vi.fn<SessionRpcCaller>(async () => ({ number: 3 }));
    const submitter = new SessionCommentSubmitter({
      ...BASE,
      getAccessToken,
      rpc,
    });

    await submitter.submit(PAYLOAD);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "create_review_comment",
      expect.any(Object),
      "refreshed-jwt",
    );
  });

  it("returns ok:false with a message when the RPC throws", async () => {
    const submitter = new SessionCommentSubmitter({
      ...BASE,
      getAccessToken: () => "jwt",
      rpc: async () => {
        throw new Error("no_review_session");
      },
    });
    const result = await submitter.submit(PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no_review_session");
  });

  it("returns ok:false when the server omits a number", async () => {
    const submitter = new SessionCommentSubmitter({
      ...BASE,
      getAccessToken: () => "jwt",
      rpc: async () => ({}),
    });
    const result = await submitter.submit(PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.number).toBe(0);
  });

  it("throws when constructed without a previewId", () => {
    expect(
      () =>
        new SessionCommentSubmitter({
          supabaseUrl: BASE.supabaseUrl,
          supabaseAnonKey: BASE.supabaseAnonKey,
          previewId: "",
          getAccessToken: () => "jwt",
        }),
    ).toThrow(/previewId/i);
  });
});
