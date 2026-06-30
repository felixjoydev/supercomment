/**
 * Supabase URL allow-listing (security review, finding 4).
 *
 * The member JWT is attached as a Bearer to whatever `supabaseUrl` a binding
 * carries — and that URL originates over the network (the /cli-auth page posts
 * its own NEXT_PUBLIC_SUPABASE_URL). To make sure the crown-jewel token can only
 * ever be sent to a real Supabase project, we require https and pin the host to
 * the managed `*.supabase.co` domain before building any client. Self-hosters
 * (custom domains) opt in explicitly via SUPERCOMMENT_ALLOWED_SUPABASE_HOSTS.
 */

/** True if `host` is the managed Supabase domain or an explicitly allowed host. */
export function isAllowedSupabaseHost(
  host: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const h = host.toLowerCase();
  // Leading dot is required so "evil-supabase.co" / "supabase.co.evil.com" fail.
  if (h === "supabase.co" || h.endsWith(".supabase.co")) return true;
  const allow = (env.SUPERCOMMENT_ALLOWED_SUPABASE_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return allow.includes(h);
}

/**
 * Throw unless `raw` is an https URL pointing at an allowed Supabase host. Call
 * this before sending the member token anywhere (login, init, MCP store).
 */
export function assertAllowedSupabaseUrl(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid Supabase URL: ${JSON.stringify(raw)}.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `Refusing to send the member token to a non-https Supabase URL (${raw}).`,
    );
  }
  if (!isAllowedSupabaseHost(url.hostname, env)) {
    throw new Error(
      `Refusing to send the member token to an unexpected Supabase host ` +
        `"${url.hostname}". Expected *.supabase.co — set ` +
        `SUPERCOMMENT_ALLOWED_SUPABASE_HOSTS to allow a self-hosted host.`,
    );
  }
}
