/**
 * U6 STUB for the U5/U9 submission seam.
 *
 * `StubCommentSubmitter` is a minimal placeholder so the overlay is interactive
 * on its own; the real guest/member RPC call replaces it at wiring time. (The
 * former `StubContextCapturer` was superseded by the real tiered capture and has
 * been removed.)
 */
import type { CommentSubmitter, SubmitResult } from "./types.js";

/**
 * Console-logging submitter. Allocates a fake incrementing number so markers
 * render during local development; the real per-preview number comes from the
 * `create_guest_comment` RPC (U5/U9).
 */
export class StubCommentSubmitter implements CommentSubmitter {
  private next = 1;

  submit(payload: unknown): SubmitResult {
    const number = this.next++;
    // eslint-disable-next-line no-console
    console.log("[SuperComment] (stub) submit comment", { number, payload });
    return { ok: true, number };
  }
}
