/**
 * Map a raw comment-submit RPC rejection to a clear, actionable reviewer message
 * (U13 / G5 / G21).
 *
 * Extracted from OverlayController as a pure function so the mapping is
 * independently unit-testable (the controller's `showSubmitError` renders the
 * result as a transient notice while preserving the draft + edit buffer). The
 * match is substring + case-insensitive because the raw message is a PostgREST /
 * RPC error string that embeds the machine code (e.g. "…rate_limited…").
 */
export function mapSubmitError(message?: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("rate_limited")) {
    return "You're commenting too quickly. Wait a moment, then submit again.";
  }
  if (m.includes("payload_too_large")) {
    return "This edit is too large to save. Remove a few changes and submit again.";
  }
  if (m.includes("no_review_session") || m.includes("invalid_token")) {
    // The ~8h review session lapsed; a fresh token needs the /s hop (G21).
    return "Your review session has expired. Reload the page to keep reviewing.";
  }
  return "Couldn't save your comment. Please try again.";
}
