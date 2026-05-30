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

export interface BadgeColors {
  bg: string;
  fg: string;
  border: string;
}

export function severityColors(severity: Severity): BadgeColors {
  switch (severity) {
    case "critical":
      return { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" };
    case "important":
      return { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" };
    case "minor":
    default:
      return { bg: "#f0f9ff", fg: "#0369a1", border: "#bae6fd" };
  }
}

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
