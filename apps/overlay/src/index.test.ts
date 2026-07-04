import { describe, it, expect } from "vitest";

import { buildMountConfig, evaluateBoot } from "./index.js";
import type {
  CommentSubmitter,
  ContextCapturer,
  SubmitResult,
} from "./core/types.js";
import type { ThreadClient } from "./submit/thread.js";

/**
 * The activation gate (U8/R18/R21): the overlay — and therefore every editor,
 * upload and capture listener — mounts ONLY when this returns a non-`dormant`
 * mode. These tests lock that decision so a regression can't quietly activate
 * the editor on a bare production page.
 */
describe("evaluateBoot — overlay activation gate", () => {
  it("stays dormant on a bare production page (no link secret, no token, no session)", () => {
    expect(evaluateBoot({ token: null, hasLiveSession: false })).toBe("dormant");
  });

  it("activates embedded when a review token is present in the URL", () => {
    expect(evaluateBoot({ token: "tok", hasLiveSession: false })).toBe("embedded");
  });

  it("activates embedded when an unexpired session is persisted (reload path)", () => {
    expect(evaluateBoot({ token: null, hasLiveSession: true })).toBe("embedded");
  });

  it("uses the tunnel path when a link secret is present (legacy), even with a token", () => {
    expect(
      evaluateBoot({ linkSecret: "s", token: null, hasLiveSession: false }),
    ).toBe("tunnel");
    expect(
      evaluateBoot({ linkSecret: "s", token: "tok", hasLiveSession: true }),
    ).toBe("tunnel");
  });

  it("treats an empty/absent link secret as not-tunnel", () => {
    expect(
      evaluateBoot({ linkSecret: "", token: null, hasLiveSession: false }),
    ).toBe("dormant");
    expect(
      evaluateBoot({ linkSecret: null, token: "tok", hasLiveSession: false }),
    ).toBe("embedded");
  });
});

/**
 * mount() builds the controller's OverlayConfig from the caller's overrides. It
 * used to hand-list the forwarded fields and silently dropped `threadClient` +
 * `currentUser`, so embedded pin popovers never received a thread client and went
 * read-only (no reply box / mark-done / delete on the live site). These lock the
 * forwarding so that regression can't come back.
 */
describe("buildMountConfig — forwards every caller seam", () => {
  const stubCapturer: ContextCapturer = {
    capture: () => ({
      selector: "s",
      anchors: [],
      url: "https://example.test/",
      consoleErrors: [],
    }),
  };
  const stubSubmitter: CommentSubmitter = {
    submit: (): SubmitResult => ({ ok: true, number: 1 }),
  };
  const stubThread = {
    listReplies: async () => [],
    createReply: async () => null,
    resolve: async () => true,
    deleteReply: async () => true,
    deleteThread: async () => true,
  } as unknown as ThreadClient;

  it("forwards the comment-thread seams so the popover stays interactive", () => {
    const currentUser = { displayName: "Ada", role: "member" };
    const config = buildMountConfig({
      capturer: stubCapturer,
      submitter: stubSubmitter,
      threadClient: stubThread,
      currentUser,
    });
    expect(config.threadClient).toBe(stubThread);
    expect(config.currentUser).toEqual(currentUser);
  });

  it("still applies computed defaults (previewId) and preserves the passed submitter", () => {
    const config = buildMountConfig({
      capturer: stubCapturer,
      submitter: stubSubmitter,
    });
    expect(config.submitter).toBe(stubSubmitter);
    expect(typeof config.previewId).toBe("string");
    expect(config.previewId.length).toBeGreaterThan(0);
    expect(config.threadClient).toBeUndefined();
  });
});
