import type { ChangeOp } from "@supercomment/shared";

/**
 * A stable key for "the same logical edit". Style/text/attr/remove/move/
 * visibility ops coalesce by target + property + breakpoint + state; every
 * `insertNode` is distinct (keyed by its opId) since each is a new node.
 *
 * Lives in its own module so both the edit-session facade and the history engine
 * can import it without a cycle.
 */
export function opKey(op: ChangeOp): string {
  const t = op.target;
  const targetId = t.source
    ? `${t.source.file}:${t.source.line}:${t.source.column}`
    : t.selector;
  if (op.type === "insertNode") {
    return `insertNode|${op.opId}`;
  }
  return [
    op.type,
    targetId,
    op.property ?? "",
    op.responsive ?? "base",
    op.state ?? "default",
  ].join("|");
}
