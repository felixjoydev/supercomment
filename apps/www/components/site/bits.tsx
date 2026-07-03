import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A typographic check for "supported" cells. Not an emoji; carries an a11y label. */
export function Check() {
  return (
    <span className="inline-flex items-center text-done-dot" role="img" aria-label="Yes">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 8.5 6.2 11.5 13 4.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export type Stage = "backlog" | "agent" | "review" | "done";

const stageLabels: Record<Stage, string> = {
  backlog: "Backlog",
  agent: "Agent Ready",
  review: "Review",
  done: "Done",
};

export function StagePill({ stage }: { stage: Stage }) {
  return (
    <span className={cn("pill", `pill--${stage}`)}>
      <span className="dot" />
      {stageLabels[stage]}
    </span>
  );
}

/** Integration launch state, driven by the single integrationStatus constant. */
export function StatusBadge({ status }: { status: "live" | "coming-soon" }) {
  if (status === "live") {
    return (
      <span className="pill pill--done">
        <span className="dot" />
        Live
      </span>
    );
  }
  return (
    <span className="pill pill--backlog">
      <span className="dot" />
      Coming soon
    </span>
  );
}

/** A quiet feature row: fragment header + one mechanism sentence. */
export function FeatureRow({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-ink-2">{children}</p>
    </div>
  );
}
