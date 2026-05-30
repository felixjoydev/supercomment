/**
 * `supercomment start` exposure warning (U13 / R24).
 *
 * Sharing a SuperComment preview exposes a RUNNING dev server to the network.
 * Before the proxy/tunnel goes live, the CLI prints a clear, honest warning of
 * exactly what is being exposed and to whom, so the dev makes an informed
 * choice. Team-only is the safe default; a guest link widens exposure to anyone
 * who holds the link.
 *
 * This builder is pure and testable; the bin wiring just prints its result.
 */

/** Who can reach the shared preview. */
export type AccessMode = "team-only" | "guest";

export interface ExposureWarningInput {
  /** The local port the dev server / proxy listens on. */
  port: number;
  /** The host the proxy binds to (e.g. "127.0.0.1" or "0.0.0.0"). */
  host: string;
  /** The selected access mode. `team-only` is the default and safest. */
  accessMode: AccessMode;
}

/** The default (safest) access mode. */
export const DEFAULT_ACCESS_MODE: AccessMode = "team-only";

/**
 * Build the multi-line exposure warning string for `supercomment start`.
 *
 * It always states: the host:port being exposed, the access mode, that
 * team-only is the safe default, and — when a guest link is in play — that the
 * link exposes the running app to anyone who holds it.
 */
export function buildExposureWarning(input: ExposureWarningInput): string {
  const { port, host, accessMode } = input;
  const hostPort = `${host}:${port}`;

  const lines: string[] = [];
  lines.push("⚠  SuperComment is about to share your running app.");
  lines.push(`   Exposed: ${hostPort} (your local dev server)`);
  lines.push(`   Access mode: ${accessMode}`);

  if (accessMode === "team-only") {
    lines.push(
      "   Only signed-in members of your team can open this preview. " +
        "This is the safe default.",
    );
  } else {
    lines.push(
      "   GUEST LINK: anyone who has the link can open your running app — " +
        "no sign-in required. Share it only with people you trust.",
    );
    lines.push(
      `   The default is team-only (${DEFAULT_ACCESS_MODE}); switch back if a ` +
        "guest link is not needed.",
    );
  }

  lines.push(
    "   Your app keeps full access to its own data/credentials while shared; " +
      "secrets in the page are redacted before capture, but do not share if " +
      "the running app exposes data you would not want a viewer to see.",
  );

  return lines.join("\n");
}
