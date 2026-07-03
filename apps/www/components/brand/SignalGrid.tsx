import { cn } from "@/lib/cn";

export type Signal = { title: string; body: string };

/**
 * The twelve signals as a two-up grid: a period-terminated fragment header in
 * ink, one mechanism sentence in body. Titles carry their own trailing period.
 */
export function SignalGrid({
  items,
  className,
}: {
  items: Signal[];
  className?: string;
}) {
  return (
    <div className={cn("grid gap-x-10 gap-y-6 sm:grid-cols-2", className)}>
      {items.map((it) => (
        <p key={it.title} className="text-ink-2">
          <strong className="font-semibold text-ink">{it.title}</strong>{" "}
          {it.body}
        </p>
      ))}
    </div>
  );
}
