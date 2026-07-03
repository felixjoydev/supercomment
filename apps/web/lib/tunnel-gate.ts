/**
 * Hosted tunnel-proxy gate (H1).
 *
 * The web `/s/[slug]` reverse proxy (route.ts `proxyTunnel`) forwards a
 * reviewer's request to a developer-controlled cloudflared tunnel and streams
 * the response back FROM THE DASHBOARD ORIGIN. That path is legacy/dormant — the
 * product ships embedded review mode — but until now it was always reachable:
 * unlike the CLI (which consults `isTunnelEnabled` before spawning anything), no
 * code on the hosted side gated it, so any member could point a tunnel at an
 * attacker origin and have it served same-origin as the dashboard.
 *
 * This gate closes that: `proxyTunnel` is dormant unless the deployment sets
 * `SUPERCOMMENT_ENABLE_TUNNEL` (the same flag name the CLI + proxy-headers.ts
 * already document). Default off. Kept side-effect-free so it is unit-testable
 * without importing next/server.
 */

/**
 * True iff `SUPERCOMMENT_ENABLE_TUNNEL` is set to a truthy value. Unset/empty and
 * the common falsey spellings ("0", "false", "no", "off", case-insensitive,
 * surrounding whitespace ignored) are disabled; anything else enables it. Matches
 * the CLI's isTunnelEnabled so one env var governs both processes. Takes the raw
 * value (not the env object) so it is trivially unit-testable and avoids the
 * Next-augmented `ProcessEnv` typing.
 */
export function isWebTunnelEnabled(
  raw: string | undefined = process.env.SUPERCOMMENT_ENABLE_TUNNEL,
): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "0" || v === "false" || v === "no" || v === "off") {
    return false;
  }
  return true;
}
