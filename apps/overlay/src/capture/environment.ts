import type { Environment } from "@supercomment/shared";

/**
 * Browser/runtime environment capture (read-only).
 *
 * `userAgent` + `language` + `platform` let an agent reason about
 * browser/OS-specific bugs ("only on Safari", "only on mobile"). These values
 * are non-sensitive, so no redaction is applied. Returns null when there is no
 * navigator (e.g. SSR/non-browser).
 */

interface NavigatorLike {
  userAgent?: string;
  language?: string;
  platform?: string;
  userAgentData?: { platform?: string };
}

interface ViewLike {
  navigator?: NavigatorLike;
}

export function captureEnvironment(
  view: ViewLike | undefined,
): Environment | null {
  const nav = view?.navigator;
  const userAgent = nav?.userAgent;
  if (!userAgent) {
    return null;
  }
  const environment: Environment = { userAgent };
  if (nav?.language) {
    environment.language = nav.language;
  }
  // Prefer the modern, non-deprecated hint; fall back to navigator.platform.
  const platform = nav?.userAgentData?.platform ?? nav?.platform;
  if (platform) {
    environment.platform = platform;
  }
  return environment;
}
