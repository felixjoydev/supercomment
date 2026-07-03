/**
 * The shared "write atomically via a temp sibling" mechanism.
 *
 * Writing to `${path}.tmp-<pid>` and then `rename`-ing it over the final path is
 * atomic on the same filesystem, so a concurrent reader never observes a
 * half-written file and a crash mid-write cannot corrupt an existing one.
 *
 * The caller supplies its own (injectable, testable) fs ops, so this stays
 * decoupled from `node:fs` and from any per-file concerns — e.g. the binding
 * writer applies 0600 inside its own `writeFile`, while the committed repo-link
 * file needs no special mode.
 */
export interface AtomicWriteOps {
  mkdir: (dir: string, opts: { recursive: true }) => Promise<unknown>;
  writeFile: (path: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

export async function atomicWriteVia(
  ops: AtomicWriteOps,
  dir: string,
  path: string,
  data: string,
): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await ops.mkdir(dir, { recursive: true });
  await ops.writeFile(tmp, data);
  await ops.rename(tmp, path);
}
