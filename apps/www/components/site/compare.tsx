import type { ReactNode } from "react";

/** The paired "Choose X if / Choose SuperComment if" decision blocks. */
export function ChooseBlocks({
  theirName,
  theirReason,
  ourReason,
}: {
  theirName: string;
  theirReason: ReactNode;
  ourReason: ReactNode;
}) {
  return (
    <div className="mt-12 grid gap-6 md:grid-cols-2">
      <div className="sc-card-soft p-6">
        <h3 className="text-lg font-semibold text-ink">Choose {theirName} if…</h3>
        <p className="mt-2 text-ink-2">{theirReason}</p>
      </div>
      <div className="sc-card-soft p-6">
        <h3 className="text-lg font-semibold text-ink">
          Choose SuperComment if…
        </h3>
        <p className="mt-2 text-ink-2">{ourReason}</p>
      </div>
    </div>
  );
}
