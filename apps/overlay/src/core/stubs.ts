/**
 * U6 STUBS for the U7 (context capture) and U5/U9 (submission) seams.
 *
 * These are intentionally minimal placeholders so the overlay is fully
 * interactive on its own. U7 will replace `StubContextCapturer` with the real
 * tiered capture (selectors, computed styles, surrounding HTML, screenshot,
 * React fiber walk); U5/U9 will replace `StubCommentSubmitter` with the real
 * guest/member RPC call. DO NOT build that here.
 */
import type { CapturedContext } from "@supercomment/shared";
import type {
  ContextCapturer,
  CommentSubmitter,
  SelectionTarget,
  SubmitResult,
} from "./types.js";

/**
 * No-op context capturer. Returns the bare minimum that satisfies the shared
 * `capturedContextSchema` so the overlay can assemble a parseable payload —
 * real model-ready context (computed styles, HTML, screenshot, React) is U7.
 */
export class StubContextCapturer implements ContextCapturer {
  capture(target: SelectionTarget): CapturedContext {
    const url =
      typeof location !== "undefined" ? location.href : "https://example.invalid/";

    const base = {
      // U7 will compute a real, robust selector + multi-anchor set.
      selector: stubSelectorFor(target),
      anchors: stubAnchorsFor(target),
      url,
      consoleErrors: [],
    } satisfies CapturedContext;

    return base;
  }
}

function stubSelectorFor(target: SelectionTarget): string {
  switch (target.kind) {
    case "element":
      return target.element.tagName?.toLowerCase() || "*";
    case "multi":
      return target.elements
        .map((el) => el.tagName?.toLowerCase() || "*")
        .join(", ");
    case "area":
      return ":root";
    case "text":
      return ":root";
  }
}

function stubAnchorsFor(
  target: SelectionTarget,
): { type: string; value: string }[] {
  switch (target.kind) {
    case "text":
      return [{ type: "text", value: target.quotedText }];
    case "element":
      return [{ type: "dom-path", value: stubSelectorFor(target) }];
    case "multi":
      return [{ type: "dom-path", value: stubSelectorFor(target) }];
    case "area":
      return [{ type: "region", value: JSON.stringify(target.rect) }];
  }
}

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
