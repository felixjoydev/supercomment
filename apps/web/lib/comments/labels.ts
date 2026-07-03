/**
 * Pure presentation helpers for comment badges (severity colour, intent label,
 * trust label, status label). No DOM — node-testable and reused by the UI.
 */

import type {
  Severity,
  Intent,
  TrustLevel,
  CommentStatus,
} from "@supercomment/shared";

export function severityLabel(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "important":
      return "Important";
    case "minor":
    default:
      return "Minor";
  }
}

export function intentLabel(intent: Intent): string {
  switch (intent) {
    case "fix":
      return "Fix";
    case "change":
      return "Change";
    case "question":
    default:
      return "Question";
  }
}

export function trustLabel(trust: TrustLevel): string {
  return trust === "guest" ? "Guest" : "Member";
}

export function statusLabel(status: CommentStatus): string {
  switch (status) {
    case "resolved":
      return "Resolved";
    case "dismissed":
      return "Dismissed";
    case "open":
    default:
      return "Open";
  }
}
