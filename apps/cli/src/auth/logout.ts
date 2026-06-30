/**
 * `supercomment logout` — remove the local binding. Idempotent (a missing
 * binding is not an error). After this the `supercomment` MCP server can no
 * longer read comments until the developer logs in again.
 */
import { clearProjectBinding } from "../config/binding.js";

export interface RunLogoutOptions {
  /** Injectable for tests; defaults to clearing the real binding file. */
  clearBinding?: () => Promise<string>;
  log?: (line: string) => void;
}

/** Clear the binding and report the path that was targeted. */
export async function runLogout(opts: RunLogoutOptions = {}): Promise<string> {
  const log = opts.log ?? ((l: string) => process.stdout.write(l + "\n"));
  const clear = opts.clearBinding ?? (() => clearProjectBinding());
  const path = await clear();
  log(`✔ Logged out. Removed ${path}.`);
  log(
    "The `supercomment` MCP server will return no comments until you run " +
      "`supercomment login` again.",
  );
  return path;
}
