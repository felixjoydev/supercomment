import { cn } from "@/lib/cn";
import { PayloadCard } from "./PayloadCard";
import { PipelineBoard, type BoardCard } from "./PipelineBoard";

function BrowserFrame({
  url,
  children,
  className,
}: {
  url: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("sc-card overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
        </div>
        <div className="ml-1 flex-1 truncate rounded-md border border-line bg-surface px-2.5 py-1 font-mono text-[11px] text-ink-3">
          {url}
        </div>
      </div>
      <div className="relative bg-surface">{children}</div>
    </div>
  );
}

function CommentPin() {
  return (
    <span className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-white shadow-soft">
      1
    </span>
  );
}

function CommentBox({ note }: { note: string }) {
  return (
    <div className="loop-comment absolute bottom-4 right-4 w-56 sc-card p-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-inset text-[10px] font-semibold text-ink">
          M
        </span>
        <span className="text-[11px] text-ink-3">Client · guest</span>
      </div>
      <p className="mt-2 text-sm text-ink">{note}</p>
    </div>
  );
}

function StatusFlip({ done }: { done: "Done" | "Resolved" }) {
  return (
    <span className="relative inline-flex items-center">
      <span className="pill pill--review loop-status-review absolute left-0">
        <span className="dot" />
        Review
      </span>
      <span className="pill pill--done loop-status-done">
        <span className="dot" />
        {done}
      </span>
    </span>
  );
}

const boardCards: BoardCard[] = [
  { stage: "done", selector: "button.cta--hero", note: "Lost on mobile" },
  { stage: "review", selector: "nav.header", note: "Logo spacing" },
  { stage: "agent", selector: "section.pricing", note: "Copy: Start free" },
  { stage: "backlog", selector: "footer.links", note: "Broken link" },
];

/**
 * The homepage hero visual: a real page under review, a guest comment on the
 * highlighted element, the capture assembling into the payload card, and the
 * status flipping to resolved. One signature animation, plays once, honoring
 * prefers-reduced-motion (which shows the finished state).
 */
export function HeroVisual({ variant }: { variant: "v1" | "v2" }) {
  const note =
    variant === "v1"
      ? "This CTA gets lost on mobile."
      : "This gets lost on mobile.";

  return (
    <div className="loop-scene relative">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <BrowserFrame url="staging.acme.app" className="lg:mt-6">
          <div className="relative px-5 pb-28 pt-5">
            <div className="flex items-center justify-between">
              <div className="h-2.5 w-16 rounded-full bg-inset" />
              <div className="flex gap-1.5">
                <span className="h-2 w-8 rounded-full bg-inset" />
                <span className="h-2 w-8 rounded-full bg-inset" />
                <span className="h-2 w-8 rounded-full bg-inset" />
              </div>
            </div>
            <div className="mt-9 max-w-[80%]">
              <div className="text-lg font-semibold text-ink">
                Ship faster with Acme.
              </div>
              <div className="mt-3 h-2 w-full rounded-full bg-inset" />
              <div className="mt-1.5 h-2 w-2/3 rounded-full bg-inset" />
              <div className="mt-6">
                <span className="relative inline-flex rounded-lg ring-2 ring-review-dot ring-offset-2">
                  <span className="inline-flex rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-white">
                    Get started
                  </span>
                  <CommentPin />
                </span>
              </div>
            </div>
            <CommentBox note={note} />
          </div>
        </BrowserFrame>

        <div className="space-y-4">
          <PayloadCard animate className="loop-card" />
          <div className="loop-status flex items-center gap-3 pl-1">
            <span className="text-sm text-ink-2">Comment</span>
            <span aria-hidden="true" className="text-ink-3">
              {"→"}
            </span>
            <StatusFlip done={variant === "v1" ? "Resolved" : "Done"} />
          </div>
        </div>
      </div>

      {variant === "v2" ? (
        <div className="mt-4">
          <PipelineBoard cards={boardCards} />
        </div>
      ) : null}
    </div>
  );
}
