/**
 * Identity helpers for the login handoff (security review, finding 2).
 *
 * The "Logged in as <email>" line must reflect WHICH account actually got bound,
 * so it has to come from the token itself — not from an attacker-influenceable
 * `email` field in the POST body. We decode the JWT payload for display only
 * (the token's authenticity is established by the loopback + state handoff; we
 * are not making a trust decision off this value, only telling the human which
 * account they bound — and a wrong/forged token would correctly show the wrong
 * email rather than a spoofed-correct one).
 *
 * Anything derived from untrusted input is also stripped of control characters
 * before it reaches the terminal, to prevent ANSI/escape-sequence injection.
 */

/** Decode a JWT's payload segment, or undefined if unreadable. */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims = JSON.parse(json) as unknown;
    return typeof claims === "object" && claims !== null
      ? (claims as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Decode a JWT's `email` claim, or undefined if unreadable / absent. */
export function decodeJwtEmail(token: string): string | undefined {
  const email = decodeJwtPayload(token)?.email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}

/** Decode a JWT's `exp` claim (unix seconds), or undefined if unreadable / absent. */
export function decodeJwtExp(token: string): number | undefined {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === "number" ? exp : undefined;
}

/**
 * Strip ASCII control characters (codes 0x00..0x1F, incl. ESC) and DEL (0x7F)
 * so an untrusted string can't inject ANSI escape sequences into the terminal
 * when printed. Implemented by char code to keep the source free of literal
 * control bytes.
 */
export function sanitizeForTerminal(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out;
}
