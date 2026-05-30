/**
 * Pure state machine for the per-comment "Send to Claude" button.
 *
 * idle ──send──▶ sending ──ok──▶ sent ──(consumer)──▶ working ──done──▶ done
 *   ▲              │ fail                                  │ fail
 *   └──────────────┴──────────────────────────────────────┴──▶ failed ──retry──▶ sending
 *
 * `confirm_required` is a distinct surface state used for guest comments (R23):
 * the button cannot move to `sending` until the user confirms.
 */

export type SendState =
  | "idle"
  | "confirm_required"
  | "sending"
  | "sent"
  | "working"
  | "done"
  | "failed";

export type SendAction =
  | { type: "request"; requiresConfirm: boolean }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "succeeded" } // server accepted the enqueue (status pending)
  | { type: "failed" }
  | { type: "working" } // consumer picked it up
  | { type: "completed" }; // consumer finished

export function sendReducer(state: SendState, action: SendAction): SendState {
  switch (action.type) {
    case "request":
      if (state === "sending" || state === "working") return state;
      return action.requiresConfirm ? "confirm_required" : "sending";
    case "confirm":
      return state === "confirm_required" ? "sending" : state;
    case "cancel":
      return state === "confirm_required" ? "idle" : state;
    case "succeeded":
      return state === "sending" ? "sent" : state;
    case "working":
      return state === "sent" || state === "sending" ? "working" : state;
    case "completed":
      return "done";
    case "failed":
      return "failed";
    default:
      return state;
  }
}

export function isInFlight(state: SendState): boolean {
  return state === "sending" || state === "sent" || state === "working";
}

export function sendButtonLabel(state: SendState): string {
  switch (state) {
    case "confirm_required":
      return "Confirm send";
    case "sending":
      return "Sending…";
    case "sent":
      return "Queued";
    case "working":
      return "Working…";
    case "done":
      return "Done";
    case "failed":
      return "Retry";
    case "idle":
    default:
      return "Send to Claude";
  }
}

/**
 * Map a queue row's persisted status (from the comment_queue table / realtime)
 * onto the button state, so the UI reflects the consumer's progress.
 */
export function sendStateFromQueueStatus(
  status: "pending" | "working" | "done" | "failed",
): SendState {
  switch (status) {
    case "pending":
      return "sent";
    case "working":
      return "working";
    case "done":
      return "done";
    case "failed":
      return "failed";
  }
}
