/**
 * Core overlay types shared across toolbar / selection / markers / guest.
 *
 * These are intentionally framework-agnostic and contain no DOM rendering;
 * the actual UI lives in the sibling modules. Everything here is pure data so
 * the selection/marker logic can be unit-tested without a real browser.
 */
import type {
  Intent,
  Severity,
  NewCommentInput,
  CapturedContext,
  ElementAnchor,
} from "@supercomment/shared";

/** The four selection modes the toolbar exposes (R9). */
export type SelectionMode = "element" | "area" | "text" | "multi";

/** A rectangle in document (page) coordinates, CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Human-readable content of a comment, shown in a popover when its marker is clicked. */
export interface MarkerComment {
  note: string;
  authorDisplayName: string;
  intent?: string;
  severity?: string;
  status?: string;
  createdAt?: string;
}

/**
 * An EXISTING comment loaded back onto the live deploy and rendered as a marker.
 *
 * U8 (re-anchor on activate): the controller re-resolves the live element from
 * {@link anchors} against the current DOM and places the marker at the element's
 * CURRENT rect, deriving stale-ness from anchor corroboration. `rect` is the
 * capture-time `context.boundingBox` (document coords; null when none was
 * stored) and is used only as the best-effort fallback position for a comment
 * that goes stale. `isStale` is the server-persisted flag (NOT consulted by the
 * live re-anchor pass, which recomputes stale-ness client-side per plan).
 */
export interface ExistingCommentMarker {
  /** Stable per-preview comment number shown on the pin. */
  number: number;
  /** Capture-time position (document coords) from context.boundingBox. */
  rect: Rect | null;
  /** Server-persisted stale flag (retained for callers; not used by U8). */
  isStale: boolean;
  /** Captured multi-anchor set, re-resolved against the live DOM (U8). */
  anchors: ElementAnchor[];
  /** Human-readable comment content shown in the marker's popover (U12 read). */
  content: MarkerComment;
}

/**
 * What the reviewer selected, normalised across the four modes. This is the
 * input U7 turns into a full `CapturedContext`; the overlay itself only knows
 * the targeted element(s)/region/quoted text and where to anchor UI.
 */
export type SelectionTarget =
  | {
      kind: "element";
      element: Element;
      /** Document-space rect of the element, used to anchor the form/marker. */
      rect: Rect;
    }
  | {
      kind: "area";
      /** The dragged region in document space. */
      rect: Rect;
    }
  | {
      kind: "text";
      /** The quoted text the reviewer selected. */
      quotedText: string;
      /** Rect of the selection range, used to anchor the form/marker. */
      rect: Rect;
    }
  | {
      kind: "multi";
      elements: Element[];
      /** Union rect of all selected elements. */
      rect: Rect;
    };

/** The intent + severity + note a reviewer fills into the comment form (R10). */
export interface CommentDraft {
  note: string;
  intent: Intent;
  severity: Severity;
}

/**
 * U7 SEAM — context capture.
 *
 * U6 does NOT implement real context capture (selectors, computed styles,
 * surrounding HTML, screenshots, React fiber walk). It calls this injected
 * interface, which U7 will provide. The default implementation is a clearly
 * marked no-op stub (see `core/stubs.ts`).
 */
export interface ContextCapturer {
  /**
   * Produce the model-ready `CapturedContext` for a finished selection.
   * U7 owns the real implementation; U6 ships a stub.
   */
  capture(target: SelectionTarget): Promise<CapturedContext> | CapturedContext;
}

/**
 * U5 SEAM — comment submission.
 *
 * U6 assembles a partial `NewCommentInput` (selection-derived context + note +
 * intent + severity + guest display name) and hands it to this interface. The
 * real network/RPC call (guest `create_guest_comment` or the member path) is
 * U5/U9; U6 ships a console stub.
 */
export interface CommentSubmitter {
  submit(payload: NewCommentInput): Promise<SubmitResult> | SubmitResult;
}

/** Result of a submission — the server-allocated number drives marker labels. */
export interface SubmitResult {
  ok: boolean;
  /** Stable per-preview number the server allocated (R13). */
  number: number;
  /** Optional id of the created comment. */
  id?: string;
  message?: string;
}

/** Everything the overlay needs to be constructed against. */
export interface OverlayConfig {
  /** The preview this overlay is annotating (R13 numbering scope). */
  previewId: string;
  /**
   * Per-preview key used to namespace the stored guest display name so two
   * previews open in the same browser don't share a reviewer identity.
   */
  previewKey: string;
  capturer: ContextCapturer;
  submitter: CommentSubmitter;
  /** Document to operate on; defaults to the ambient `document` in browsers. */
  doc?: Document;
  /** Storage for the guest name; defaults to `localStorage` in browsers. */
  storage?: NameStorage;
}

/** Minimal storage surface so the guest store is testable without a browser. */
export interface NameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
