/**
 * Pure helpers for the CLI auth handoff (/cli-auth).
 *
 * SECURITY: the CLI hands the page only a PORT, never a callback URL. The page
 * therefore POSTs the member token to a destination it constructs itself —
 * always `http://127.0.0.1:<port>/callback` — so there is no attacker-supplied
 * URL to validate or be tricked by. All we must do is confirm the port is a
 * plausible TCP port; everything else about the destination is fixed here.
 */

/** The fixed loopback host the CLI callback server binds to. */
export const CLI_CALLBACK_HOST = "127.0.0.1";

/**
 * Lowest port the page will POST the session token to. The CLI's callback server
 * always binds an OS-assigned ephemeral port (well above this), so legitimate
 * flows are unaffected; rejecting privileged ports (below 1024) narrows the set of
 * victim-local services an attacker-supplied `?port=` could be aimed at (security
 * review finding 1).
 */
export const MIN_CALLBACK_PORT = 1024;

/**
 * Validate the `?port=` handed to /cli-auth. Returns the port number, or null
 * when it is missing/non-numeric/out of range. Digits-only (no "3000abc", hex,
 * or signs) and within MIN_CALLBACK_PORT..65535 (privileged ports rejected).
 */
export function parseCallbackPort(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_CALLBACK_PORT || n > 65535) return null;
  return n;
}

/** Build the fixed loopback callback URL for a validated port. */
export function callbackUrl(port: number): string {
  return `http://${CLI_CALLBACK_HOST}:${port}/callback`;
}
