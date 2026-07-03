/**
 * Shared error helpers for the CLI.
 *
 * Consolidates the byte-identical `asError` (wrap a thrown value / Supabase
 * `{message}` error object with a context prefix) and `errorMessage`
 * (best-effort message extraction) that were copy-pasted across
 * auth/select, start, mcp/store, mcp/tools, channel, and elsewhere.
 */

/**
 * Wrap an unknown error with a context prefix. Handles a Supabase-style
 * `{ message }` error object as well as a real Error or any other value.
 */
export function asError(error: unknown, context: string): Error {
  const detail =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return new Error(`${context}: ${detail}`);
}

/** Best-effort human message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
