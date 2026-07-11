/**
 * Overlay lane projection + audience-aware labels (U10/U11).
 *
 * The DISPLAYED lane is a projection over status + lane, mirroring the dashboard
 * (apps/web/lib/comments/{view,labels}.ts §2/§5): a resolved comment shows
 * "done" and a dismissed one "dismissed", regardless of the lane column, so the
 * two can never disagree. The label set is audience-aware: a member (team
 * session) sees the real pipeline names; a reviewer never sees the internal
 * "ready for agent" / backlog vocabulary. Kept here (small, framework-free) to
 * avoid coupling the overlay bundle to the web app; the two label maps are the
 * only intentional duplication of §5.
 */
import type { CommentLane } from "@supercomment/shared";
import type { MarkerComment } from "./types.js";

export type OverlayDisplayLane = CommentLane | "done" | "dismissed";
export type OverlayAudience = "member" | "reviewer";

/** Project a marker's status + lane onto the lane it is SHOWN in (§2). */
export function displayLaneOf(
  content: Pick<MarkerComment, "status" | "lane"> | undefined,
): OverlayDisplayLane {
  const status = content?.status;
  if (status === "dismissed") return "dismissed";
  if (status === "resolved") return "done";
  return content?.lane ?? "backlog";
}

const MEMBER_LABELS: Record<OverlayDisplayLane, string> = {
  backlog: "Backlog",
  ready_for_agent: "Ready for agent",
  in_review: "In review",
  done: "Done",
  dismissed: "Dismissed",
};

// Reviewer-facing labels hide the internal pipeline (§5); never the word "guest".
const REVIEWER_LABELS: Record<OverlayDisplayLane, string> = {
  backlog: "Open",
  ready_for_agent: "In progress",
  in_review: "Ready for review",
  done: "Done",
  dismissed: "Closed",
};

/** The label for a projected display lane, per audience (default member). */
export function laneLabelFor(
  lane: OverlayDisplayLane,
  audience: OverlayAudience = "member",
): string {
  return (audience === "reviewer" ? REVIEWER_LABELS : MEMBER_LABELS)[lane];
}

/** The viewer's audience from their session role (non-member → reviewer). */
export function audienceOf(role: string | undefined): OverlayAudience {
  return role === "member" ? "member" : "reviewer";
}
