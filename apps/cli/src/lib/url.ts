/**
 * Strip trailing slash(es) from an origin / base URL so it concatenates cleanly
 * (`${trimSlash(origin)}/path`) and matches exactly for CORS / allowlist checks.
 */
export function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
