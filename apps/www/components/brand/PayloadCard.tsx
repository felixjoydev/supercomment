import { cn } from "@/lib/cn";
import { PAYLOAD_ROWS } from "@/lib/copy";

/**
 * The payload card: the structured capture as a monospace-accented object.
 * Competitors show boards built for humans; this shows what the agent sees.
 * This is the brand's signature image, built as a real component, never a
 * screenshot. `animate` staggers the rows in for the homepage hero loop.
 */
export function PayloadCard({
  rows = PAYLOAD_ROWS,
  animate = false,
  className,
  title = "capture",
}: {
  rows?: { label: string; value: string }[];
  animate?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <div className={cn("sc-card overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
        <span className="font-mono text-xs text-ink-3">{title}</span>
        <span className="font-mono text-xs text-ink-3 tnum">
          {rows.length} signals
        </span>
      </div>
      <dl className="divide-y divide-line">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={cn(
              "grid grid-cols-[88px_1fr] items-baseline gap-3 px-4 py-[7px]",
              animate && "loop-row",
            )}
            style={animate ? { animationDelay: `${0.6 + i * 0.05}s` } : undefined}
          >
            <dt className="font-mono text-[11px] uppercase tracking-wide text-ink-3">
              {row.label}
            </dt>
            <dd
              className="truncate font-mono text-[12px] text-ink"
              title={row.value}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
