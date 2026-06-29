/**
 * Tunnel-mode gate (U10 / R17).
 *
 * The cloudflared `supercomment start` path is DISABLED by default: the product
 * ships embedded review mode, and the tunnel reverse-proxy is retained only
 * behind this flag. `runStart` and all proxy/tunnel/channel/csp code stay intact
 * so flipping the flag re-enables the path; the CLI dispatch (bin/index.ts)
 * consults this gate before spawning anything.
 *
 * Kept as a tiny, side-effect-free module so it is unit-testable without
 * importing bin/index.ts (whose top-level `main()` would run the real CLI).
 */

/** The exact message printed when `start` runs with tunnel mode disabled. */
export const TUNNEL_DISABLED_MESSAGE =
  'Tunnel mode is disabled. Use embedded mode — see docs/embed/install.md.';

/**
 * True iff SUPERCOMMENT_ENABLE_TUNNEL is set to a truthy value. Unset/empty and
 * the common falsey spellings ("0", "false", "no", "off", case-insensitive,
 * surrounding whitespace ignored) are treated as disabled; anything else enables
 * the tunnel path.
 */
export function isTunnelEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.SUPERCOMMENT_ENABLE_TUNNEL;
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  if (v === '' || v === '0' || v === 'false' || v === 'no' || v === 'off') {
    return false;
  }
  return true;
}
