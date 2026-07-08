import { cn } from "@/lib/cn";
import type { Stage } from "@/components/site/bits";

const STAGES: { key: Stage; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "agent", label: "Agent Ready" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

export type BoardCard = { stage: Stage; selector: string; note: string };

const dotClass: Record<Stage, string> = {
  backlog: "bg-backlog-dot",
  agent: "bg-agent-dot",
  review: "bg-review-dot",
  done: "bg-done-dot",
};

/**
 * The pipeline board fragment: Backlog / Agent Ready / Review / Done columns in
 * the status pastels. Feedback lands in Backlog; a member drags it to Agent
 * Ready; the agent fixes and it flows to Review, then Done.
 */
export function PipelineBoard({
  cards,
  className,
}: {
  cards: BoardCard[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)}>
      {STAGES.map((stage) => {
        const items = cards.filter((c) => c.stage === stage.key);
        return (
          <div
            key={stage.key}
            className="rounded-xl border border-line bg-surface-2 p-2.5"
          >
            <div className="mb-2.5 flex items-center gap-1.5 px-0.5">
              <span className={cn("h-2 w-2 rounded-full", dotClass[stage.key])} />
              <span className="text-[11px] font-medium text-ink-2">
                {stage.label}
              </span>
            </div>
            <div className="space-y-2">
              {items.map((c, i) => (
                <div
                  key={c.selector + i}
                  className="rounded-lg border border-line bg-surface p-2.5 shadow-soft"
                >
                  <div className="truncate font-mono text-[10px] text-ink-3">
                    {c.selector}
                  </div>
                  <div className="mt-1 text-xs leading-snug text-ink">
                    {c.note}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
