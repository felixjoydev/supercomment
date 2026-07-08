import { cn } from "@/lib/cn";

/**
 * A before/after change-set: the reviewer's visual edit as exact values an agent
 * can apply. Rendered as a real monospace block, aligned as the copy shows it.
 */
export function ChangeSet({
  rows,
  className,
}: {
  rows: { prop: string; from: string; to: string }[];
  className?: string;
}) {
  const propWidth = Math.max(...rows.map((r) => r.prop.length));
  const fromWidth = Math.max(...rows.map((r) => r.from.length));
  return (
    <pre className={cn("code-block", className)}>
      {rows.map((r, i) => (
        <div key={r.prop + i}>
          <span className="text-ink-2">{r.prop.padEnd(propWidth + 2)}</span>
          <span className="text-ink-3">{r.from.padEnd(fromWidth + 1)}</span>
          <span className="text-ink-3" aria-hidden="true">
            {"→ "}
          </span>
          <span className="text-ink">{r.to}</span>
        </div>
      ))}
    </pre>
  );
}
