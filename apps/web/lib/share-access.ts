/**
 * Share-access helpers for the embedded /s redirect (U2).
 *
 * The access decision itself lives server-side in the mint_review_token RPC
 * (it sees auth.uid() via the cookie-bound client and validates the guest
 * link_secret without ever returning it). These pure helpers map the RPC's
 * outcome to a route action and build the activation redirect — kept dependency
 * -free so they are node-testable.
 */
import { isAllowedDeployUrl } from "./external-redirect";

/** Outcome of a mint_review_token call, derived from its raised exception. */
export type MintOutcome =
  | "login_required"
  | "access_denied"
  | "link_expired"
  | "preview_not_found"
  | "not_embeddable"
  | "unknown";

/** Map a Postgres/PostgREST error message from mint_review_token to an outcome. */
export function classifyMintError(message: string | null | undefined): MintOutcome {
  const m = (message ?? "").toLowerCase();
  if (m.includes("login_required")) return "login_required";
  if (m.includes("not_embeddable")) return "not_embeddable";
  if (m.includes("link_expired")) return "link_expired";
  if (m.includes("preview_not_found")) return "preview_not_found";
  if (m.includes("access_denied")) return "access_denied";
  return "unknown";
}

/** Cryptographically-random url-safe token (Web Crypto; runs in node + edge). */
export function generateReviewToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build the activation redirect target: the token goes in the URL FRAGMENT (so
 * it never reaches server logs or the Referer header) appended to the preview's
 * registered deploy_url. Returns null if deploy_url is not allowlisted — a
 * defense-in-depth re-check (register_deploy_target already validated it on
 * write), so a poisoned deploy_url can never become a redirect target.
 *
 * `subPath` (U10) lands the reviewer on a specific PAGE of the deploy (the per-
 * page "Open page" deep link `/s/<slug><path>`) rather than the root. The path is
 * resolved against the deploy origin and re-asserted to stay ON that origin, so a
 * protocol-relative ("//evil") or traversal ("../") path can never redirect off
 * the customer's own deploy.
 */
export function buildEmbeddedRedirectUrl(
  deployUrl: string,
  token: string,
  subPath?: string | null,
): string | null {
  if (!isAllowedDeployUrl(deployUrl)) return null;
  const base = deployUrl.replace(/#.*$/, "").replace(/\/+$/, "");
  const path = normalizeSubPath(subPath);
  if (path === "/") {
    // Root activation — unchanged behavior (no trailing slash).
    return `${base}#sc_token=${encodeURIComponent(token)}`;
  }
  let target: URL;
  let baseOrigin: string;
  try {
    target = new URL(path, base + "/");
    baseOrigin = new URL(base).origin;
  } catch {
    return null;
  }
  // Open-redirect guard: the resolved page must stay on the deploy origin.
  if (target.origin !== baseOrigin) return null;
  target.hash = `sc_token=${encodeURIComponent(token)}`;
  return target.toString();
}

/**
 * Normalize an incoming sub-path to a single-leading-slash, root-relative path so
 * it resolves against the deploy origin (never protocol-relative). Empty → "/".
 */
export function normalizeSubPath(subPath: string | null | undefined): string {
  if (!subPath) return "/";
  const trimmed = subPath.replace(/^\/+/, "");
  return trimmed ? "/" + trimmed : "/";
}
