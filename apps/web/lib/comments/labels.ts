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
import type { DisplayLane } from "./view";

/**
 * Who is reading a lane label. The internal pipeline names are member (team)
 * facing; reviewers get friendlier labels that hide "ready for agent" and the
 * backlog/in-review vocabulary (§5). Defaults to `member` everywhere.
 */
export type Audience = "member" | "reviewer";

// Member (team) labels — the real pipeline names.
const MEMBER_LANE_LABELS: Record<DisplayLane, string> = {
  backlog: "Backlog",
  ready_for_agent: "Ready for agent",
  in_review: "In review",
  done: "Done",
  dismissed: "Dismissed",
};

// Reviewer-facing labels — a reviewer never sees the internal lanes; their
// world is Open / In progress / Ready for review / Done, with dismissed folded
// into "Closed" (§5). Felix's preference: never call a reviewer a "guest" here.
const REVIEWER_LANE_LABELS: Record<DisplayLane, string> = {
  backlog: "Open",
  ready_for_agent: "In progress",
  in_review: "Ready for review",
  done: "Done",
  dismissed: "Closed",
};

/** The label for a (already-projected) display lane, per audience. */
export function laneLabel(
  lane: DisplayLane,
  audience: Audience = "member",
): string {
  const table =
    audience === "reviewer" ? REVIEWER_LANE_LABELS : MEMBER_LANE_LABELS;
  return table[lane];
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
