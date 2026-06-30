import type { NetworkRequest } from "@supercomment/shared";
import { redactSecrets } from "@supercomment/shared";

/**
 * Network capture via the read-only **Resource Timing API**.
 *
 * IMPORTANT (UX safety): this intentionally does NOT monkeypatch `fetch` or
 * `XMLHttpRequest`. It only reads `performance.getEntriesByType("resource")`,
 * which the browser already records. The tradeoff is that HTTP method and status
 * code are not available here — but capture stays 100% passive and cannot alter
 * the host app's request/response behaviour. (A future, opt-in fetch wrapper
 * could add status/method; that's a deliberate separate decision.)
 *
 * URLs are redacted (query strings frequently carry tokens). Read at capture
 * time; the most recent {@link MAX_REQUESTS} entries are returned.
 */

const MAX_REQUESTS = 20;
const MAX_URL_LENGTH = 300;

/**
 * Reduce a resource URL to origin + path (dropping query string and fragment,
 * which frequently carry tokens/session ids), then redact and length-cap the
 * remainder for defense in depth. Origin + path is all an agent needs to know
 * which endpoint was hit.
 */
function sanitizeUrl(raw: string): string {
  let base: string;
  try {
    const parsed = new URL(raw);
    base = `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Not a parseable absolute URL — still strip anything after ? or #.
    base = raw.split(/[?#]/)[0] ?? raw;
  }
  return redactSecrets(base).slice(0, MAX_URL_LENGTH);
}

interface ResourceEntryLike {
  name?: string;
  initiatorType?: string;
  duration?: number;
  transferSize?: number;
  startTime?: number;
}

interface PerformanceLike {
  getEntriesByType?(type: string): ResourceEntryLike[];
}

interface ViewLike {
  performance?: PerformanceLike;
}

export function captureNetworkRequests(
  view: ViewLike | undefined,
): NetworkRequest[] | null {
  const perf = view?.performance;
  if (typeof perf?.getEntriesByType !== "function") {
    return null;
  }
  let entries: ResourceEntryLike[];
  try {
    entries = perf.getEntriesByType("resource") ?? [];
  } catch {
    return null;
  }
  if (entries.length === 0) {
    return null;
  }
  const recent = entries
    .slice(-MAX_REQUESTS)
    .map(toRequest)
    .filter((r): r is NetworkRequest => r !== null);
  return recent.length > 0 ? recent : null;
}

function toRequest(entry: ResourceEntryLike): NetworkRequest | null {
  const name = entry.name;
  if (!name) {
    return null;
  }
  const request: NetworkRequest = { url: sanitizeUrl(name) };
  if (entry.initiatorType) {
    request.initiatorType = entry.initiatorType;
  }
  if (typeof entry.duration === "number") {
    request.duration = Math.round(entry.duration);
  }
  if (typeof entry.transferSize === "number") {
    request.transferSize = entry.transferSize;
  }
  if (typeof entry.startTime === "number") {
    request.startTime = Math.round(entry.startTime);
  }
  return request;
}
