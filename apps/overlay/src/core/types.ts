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
  CommentKind,
  CommentLane,
  ElementAnchor,
  DeviceSurface,
  VisualChangeSet,
} from "@supercomment/shared";
import type { ThreadClient } from "../submit/thread.js";
import type { ReviewComment } from "../read/load-comments.js";

/**
 * The toolbar modes (R9). `browse` is the passive default: the overlay
 * intercepts nothing, so the reviewer clicks links/buttons and navigates the
 * app normally while existing comment pins stay visible and clickable. The
 * middle four are annotation modes (pick a target, drop a comment); `edit` is
 * the visual-editor mode (U9) — picking an element opens the properties panel
 * instead of the comment form, and edits are buffered into the controller's
 * `EditSession` until the reviewer submits.
 */
export type SelectionMode =
  | "browse"
  | "element"
  | "area"
  | "text"
  | "multi"
  | "edit";

/**
 * A rectangle in CSS pixels. The coordinate SPACE depends on the producer (OV-10
 * — this type and markers/render.ts previously documented it contradictorily):
 *
 *   - VIEWPORT space is the load-bearing contract for the live-interaction path.
 *     `toRect(el.getBoundingClientRect())` (core/rect.ts), selection highlights,
 *     and comment markers all use viewport coordinates, because the overlay
 *     renders into a FIXED-positioned shadow layer that is itself viewport-
 *     relative (see markers/render.ts "viewport space", selection/highlight.ts).
 *   - DOCUMENT (page) space appears only where a re-anchored EXISTING comment
 *     adds the scroll offset so its marker holds position across scroll
 *     (controller.ts reanchor path).
 *
 * VERIFY IN REAL ENV before changing any coordinate math on this: marker tests
 * inject rects directly and cannot catch scroll drift between the two spaces.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Human-readable content of a comment, shown in a popover when its marker is clicked. */
export interface MarkerComment {
  /** The comment's DB id — needed to reply / resolve / delete the thread (0033). */
  id?: string;
  note: string;
  authorDisplayName: string;
  intent?: string;
  severity?: string;
  status?: string;
  createdAt?: string;
  /** `template` = a visual-edit comment; drives the distinct marker treatment (R11). */
  kind?: CommentKind;
  /**
   * Workflow lane while open (0054/U10): drives the pin's lane treatment, the
   * popover lane chip, and the member lane controls. Absent → treated as
   * backlog. "Done"/"Dismissed" are projected from `status`, never a lane value.
   */
  lane?: CommentLane;
  /**
   * The agent's "what changed" note, set when a comment was promoted to
   * in_review; shown to the reviewer on the Ready-for-review pin. Absent when none.
   */
  reviewSummary?: string;
  /**
   * The recorded visual change-set for a `template` comment, carried so selecting
   * the pin can RE-APPLY the edits live on the page (the modified-view preview).
   * Present iff `kind === "template"`.
   */
  changeSet?: VisualChangeSet;
  /**
   * Reviewer-uploaded reference images ("what I want", R19) — `captures` bucket
   * object PATHS, signed on demand for the popover (U12 read). Carried from
   * `context.referenceImages`; absent/empty for comments without any.
   */
  referenceImages?: string[];
  /** The current viewer authored this comment (drives the author edit/delete gate, 0050). */
  isOwn?: boolean;
  /** This comment has been sent to the agent (freezes author edit/delete). */
  isSent?: boolean;
  /** This comment has at least one reply (freezes author edit/delete). */
  hasReplies?: boolean;
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
  /** Device surface this comment was made on; missing/legacy → treated as "web". */
  surface?: DeviceSurface;
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

/**
 * U13 SEAM — direct-to-Storage screenshot upload.
 *
 * The controller hands the modified-state raster (an `image/*` data URL) to this
 * seam at submit and stores the returned Storage REF in `context.screenshot`, so
 * a large PNG never inflates the comment `context` (3 MiB guest cap) or every
 * MCP read. The real implementation is `submit/upload.ts:CaptureUploader`,
 * wired with the reviewer's session creds in `index.ts`; absent (tunnel / stub /
 * tests) the screenshot stays inline. Returns `null` on any failure (never
 * throws) so an upload problem can never block submission.
 */
export interface ScreenshotUploader {
  uploadDataUrl(dataUrl: string): Promise<string | null>;
  /**
   * U9: upload a FONT file to the private `fonts` bucket, returning its object
   * ref (or null on failure). Optional so existing stubs/tests still satisfy the
   * interface; the real CaptureUploader implements it.
   */
  uploadFont?(font: { bytes: Blob; contentType: string; ext: string }): Promise<string | null>;
}

/**
 * Phase 2 SEAM — hand a just-created comment to the coding agent.
 *
 * The editor footer's "Send to agent" action (member sessions with the grant)
 * folds the change-set into a `template` comment AND enqueues it. The enqueue
 * goes through the `send_comment_to_agent` RPC (0044/U3), which server-side
 * re-verifies the caller's member review session + send-to-agent grant (the
 * footer button is UX only). Returns false on any failure (never throws) so a
 * failed enqueue can't break the save. Absent (guest / tunnel / tests) the
 * action just saves.
 */
export interface AgentEnqueuer {
  enqueue(commentId: string): Promise<boolean>;
}

/**
 * U11 SEAM — move a comment between workflow lanes from a pin's popover.
 *
 * A MEMBER session's popover lane control calls this to move a comment among
 * backlog / ready_for_agent / in_review via set_comment_lane (0052) with the
 * reviewer's session creds. The RPC re-verifies membership + can_send_to_agent
 * (for ready_for_agent) server-side; the control is UX only. `confirmGuest` is
 * passed true for a ready_for_agent move — the member's deliberate click IS the
 * guest-confirm acknowledgment, matching the editor footer's send. Returns
 * false on any failure (never throws). Absent (guest / tunnel / tests) → the
 * popover shows no lane control.
 */
export interface LaneClient {
  setLane(
    commentId: string,
    lane: CommentLane,
    confirmGuest?: boolean,
  ): Promise<boolean>;
}

/**
 * U5 SEAM — member-authored "prompt for the agent" write path.
 *
 * The editor footer's prompt field (any workspace MEMBER session, R1-R3/R6 —
 * independent of whether that member also holds the send-to-agent grant)
 * captures a private instruction for the coding agent. Right after the
 * template comment it's attached to is created, this writes it via
 * `set_agent_prompt` (0043/U2) with the reviewer's session creds. The RPC
 * itself re-verifies a MEMBER session server-side (a guest is rejected there);
 * this seam's own UI gating (isMember on the panel) is the same "server is the
 * real gate, client gating is UX only" shape as `AgentEnqueuer`. Returns false
 * on any failure (never throws) so a failed prompt write can never break the
 * underlying comment save. Absent (guest / tunnel / tests) the prompt just
 * isn't persisted server-side (the field itself already never renders for a
 * non-member session either way).
 */
export interface AgentPromptWriter {
  write(commentId: string, body: string): Promise<boolean>;
}

/**
 * Read a selected reference-image file to a data URL (U17). Injectable so the
 * composer + submit path are testable without a browser `FileReader`.
 */
export type FileReaderFn = (file: Blob) => Promise<string | null>;

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
  /**
   * Optional out-of-band screenshot uploader (U13). When present, a modified-state
   * image data URL captured at submit is uploaded and replaced by its Storage ref;
   * when absent the screenshot stays inline (tunnel / stub / tests).
   */
  uploader?: ScreenshotUploader;
  /**
   * Phase 2: whether THIS session may send comments to the coding agent. True
   * only for a member review session whose member holds the grant; guests never.
   * Drives the editor footer's conditional "Send to agent" button.
   */
  canSendToAgent?: boolean;
  /**
   * Phase 2: enqueues a saved template to the agent (the "Send to agent" action).
   * Wired in embedded activation with the reviewer's session creds; absent (guest
   * / tunnel / tests) the action just saves the comment.
   */
  enqueuer?: AgentEnqueuer;
  /**
   * U11: moves an existing comment between lanes from its pin popover (member
   * sessions). Wired in embedded activation with the reviewer's session creds;
   * absent (guest / tunnel / tests) → the popover shows no lane control.
   */
  laneClient?: LaneClient;
  /**
   * U5: writes a member-authored prompt for the agent (set_agent_prompt) right
   * after a template comment is created, before it is (optionally) enqueued.
   * Wired in embedded activation with the reviewer's session creds; absent
   * (guest / tunnel / tests) a typed prompt simply isn't persisted server-side.
   */
  agentPromptWriter?: AgentPromptWriter;
  /**
   * Reply / resolve / delete client for a comment thread (0033). Wired in embedded
   * activation with the reviewer's session creds; absent (tunnel / tests) the
   * popover stays read-only.
   */
  threadClient?: ThreadClient;
  /**
   * The current reviewer's identity, used by the popover to mark their own replies
   * (which they may delete) and to show the owner-gated "delete thread" action to
   * members. Absent (tunnel / tests) → read-only popover.
   */
  currentUser?: { displayName: string; role: string };
  /**
   * Persist a guest's captured email server-side (set_guest_email, 0036 / U11).
   * Best-effort: resolves false on failure and never throws. Absent (tunnel /
   * tests) → the email is stored locally only.
   */
  captureGuestEmail?: (email: string) => Promise<boolean>;
  /**
   * Reload the preview's comments — for the per-page index popover (U12) and the
   * live/poll sync. Returns a fresh snapshot, `[]` when the preview genuinely has
   * no comments (e.g. the last one was deleted), or `null` when the READ FAILED
   * (network/token), so the sync can clear pins on a real empty but keep them on a
   * failure. Absent → the Pages popover shows no pages and the sync is a no-op.
   */
  loadComments?: () => Promise<ReviewComment[] | null>;
  /**
   * Extend/revive the review session (keepalive_review_session, 0039). Returns the
   * new expiry (ms since epoch), or null when the session has lapsed and cannot be
   * revived (link revoked/expired). Drives sliding renewal + the Renew panel.
   */
  keepAlive?: () => Promise<number | null>;
  /** Read a reference-image file to a data URL (U17); defaults to a FileReader. */
  readFile?: FileReaderFn;
  /** Document to operate on; defaults to the ambient `document` in browsers. */
  doc?: Document;
  /** Storage for the guest name; defaults to `localStorage` in browsers. */
  storage?: NameStorage;
  /**
   * True for the controller mounted INSIDE the device-mode iframe. Such a child
   * reuses the parent's submitter/session but must NOT render its own device
   * toolbar (that would nest device mode). Defaults to false (top-level).
   */
  deviceChild?: boolean;
  /**
   * The device surface this controller represents. The top-level controller is
   * "web"; a device-mode child is the chosen device's surface. Markers are
   * filtered to this surface so a mobile comment never shows on desktop.
   */
  surface?: DeviceSurface;
  /**
   * U14: a human label for the current device surface (e.g. "Mobile · 375px"),
   * shown as the edit-panel chip so a reviewer always knows which breakpoint
   * their edits are tagged to. Set only for a device-mode child; absent = base.
   */
  surfaceLabel?: string;
  /**
   * U14: a device-mode CHILD forwards its own pointer/keyboard activity to the
   * PARENT session lifecycle through this callback (the child has no keepalive of
   * its own), so editing inside the iframe keeps the review session alive.
   */
  onChildActivity?: () => void;
  /**
   * Called after a comment is successfully submitted, with the controller's
   * surface. The top-level controller uses this to keep the device-toolbar
   * per-surface counts live (incl. comments made inside the device iframe).
   */
  onCommentSubmitted?: (surface: DeviceSurface) => void;
  /**
   * Called after the reviewer confirms "Exit" (U18): clears the persisted review
   * session so the overlay stays dormant on reload / navigation (the embedded
   * bootstrap wires this to `clearSession`). The controller tears its own UI down
   * regardless; when absent (tunnel / stub / tests) Exit just closes the overlay.
   */
  onExit?: () => void;
  /**
   * U8: the SuperComment backend origin (same value used for the embedded token
   * exchange), so the font picker can fetch the curated catalog from our own
   * `/sc/fonts-catalog.json`. Absent (tunnel / stub / tests) → the picker runs
   * offline with the page's fonts + generics only.
   */
  backendOrigin?: string;
}

/** Minimal storage surface so the guest store is testable without a browser. */
export interface NameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
