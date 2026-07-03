/**
 * The trusted origin for AUTH redirect URLs — the magic-link `emailRedirectTo`
 * and the OAuth `redirectTo` (login/actions.ts).
 *
 * M4: these must NEVER be derived from the client-controlled `Host` header in
 * production. An attacker can POST a victim's email to the OTP endpoint with a
 * spoofed `Host`; if Supabase's redirect allowlist is permissive, the victim's
 * click delivers the auth `code` to the attacker's origin → account takeover.
 * NEXT_PUBLIC_APP_URL (the deployed origin, a required deploy env) is the source
 * of truth in production; the `Host` fallback is a dev-only convenience.
 *
 * Defense-in-depth: the Supabase redirect allowlist should also be exact-match
 * (just the real app origin) so a spoofed redirect target is rejected even if
 * this ever regressed.
 *
 * Pure + injectable so it is node-testable without next/headers.
 */
export function authRedirectOrigin(opts: {
  appUrl?: string | null;
  host?: string | null;
  proto?: string | null;
  isProduction: boolean;
}): string {
  const configured = opts.appUrl?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  if (opts.isProduction) {
    // Fail closed: never fall back to the spoofable Host in production.
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be set in production so auth redirect URLs are " +
        "not derived from the spoofable Host header (M4).",
    );
  }

  // Dev-only fallback: derive the origin from the request.
  const host = opts.host ?? "localhost:3000";
  const proto =
    opts.proto ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
