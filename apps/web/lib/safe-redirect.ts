/**
 * safeNextPath — validate a post-auth `?next=` redirect target.
 *
 * The team_only review flow (U2) bounces a signed-out reviewer to
 * /login?next=/s/<slug> and back after sign-in. `next` is attacker-influenceable
 * (it rides in the URL), so it must be a SAME-ORIGIN path only — never an
 * absolute URL, scheme-relative `//host`, or `/\host` (browsers can treat `\` as
 * `/`, turning these into cross-origin navigations). This patches the open
 * redirect previously present in apps/web/app/auth/callback/route.ts (plan-002):
 * the callback did a raw `${origin}${next}`, so `next=//evil.com` or
 * `next=/\evil.com` escaped the origin.
 *
 * Returns the validated path, or `/dashboard` for anything unsafe.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/dashboard";
  // Must start with exactly one '/'.
  if (!next.startsWith("/")) return "/dashboard";
  const lower = next.toLowerCase();
  // Scheme-relative, backslash-prefixed, or encoded-slash → cross-origin capable.
  if (
    next.startsWith("//") ||
    next.startsWith("/\\") ||
    lower.startsWith("/%2f") ||
    lower.startsWith("/%5c")
  ) {
    return "/dashboard";
  }
  // Backslashes anywhere are normalized to '/' by some browsers — reject.
  if (next.includes("\\")) return "/dashboard";
  // Control characters (NUL..US and DEL) can defeat the prefix checks.
  for (let i = 0; i < next.length; i++) {
    const code = next.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return "/dashboard";
  }
  return next;
}
