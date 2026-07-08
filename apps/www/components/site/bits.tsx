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

/** Pipeline stages, for the board. The status pastels belong to the board. */
export type Stage = "backlog" | "agent" | "review" | "done";

/**
 * Integration launch state, driven by the single integrationStatus constant.
 * Neutral chip with a minimal status dot: the pastel surfaces stay reserved for
 * the pipeline board, so this never reads as decoration.
 */
export function StatusBadge({ status }: { status: "live" | "coming-soon" }) {
  const live = status === "live";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-2">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          live ? "bg-done-dot" : "bg-backlog-dot",
        )}
      />
      {live ? "Live" : "Coming soon"}
    </span>
  );
}

/** A monospace code block. Children are raw text (angle brackets welcome). */
export function CodeBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <pre className={cn("code-block", className)}>{children}</pre>;
}

/** A numbered step section for the how-it-works loop. */
export function StepSection({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-[auto_1fr] md:gap-8">
      <div className="flex items-center gap-3 md:block">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white tnum">
          {n}
        </span>
      </div>
      <div className="min-w-0">
        <h2 className="text-2xl">{title}</h2>
        <div className="prose mt-4 max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
