import type { AppState } from "@supercomment/shared";
import { redactSecrets } from "@supercomment/shared";

/**
 * Client-side app-state capture — **keys only**.
 *
 * Storage keys hint at app/feature/auth state ("cart", "ff_newCheckout",
 * "auth.session") which is invaluable for diagnosing behavioural/state bugs,
 * WITHOUT exfiltrating the values (tokens, PII). We deliberately:
 *   - capture `localStorage` / `sessionStorage` keys only, never values,
 *   - never touch `document.cookie` (readable cookies are exactly the risky
 *     session/tracking ones; httpOnly cookies aren't readable anyway),
 *   - redact each key defensively in case a key itself embeds a secret,
 *   - cap the number of keys to keep payloads small.
 *
 * Read-only and fully guarded: storage access can throw in sandboxed iframes or
 * privacy modes, so every access is wrapped and degrades to null.
 */

const MAX_KEYS = 50;

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
}

interface ViewLike {
  localStorage?: StorageLike;
  sessionStorage?: StorageLike;
}

export function captureAppState(view: ViewLike | undefined): AppState | null {
  const local = readKeys(view, "localStorage");
  const session = readKeys(view, "sessionStorage");
  if (local === null && session === null) {
    return null;
  }
  return {
    localStorageKeys: local ?? [],
    sessionStorageKeys: session ?? [],
  };
}

function readKeys(
  view: ViewLike | undefined,
  which: "localStorage" | "sessionStorage",
): string[] | null {
  try {
    // Property access itself can throw (SecurityError) in some sandboxes.
    const storage = view?.[which];
    if (!storage) {
      return null;
    }
    const keys: string[] = [];
    const count = Math.min(storage.length, MAX_KEYS);
    for (let i = 0; i < count; i += 1) {
      const key = storage.key(i);
      if (key) {
        keys.push(redactSecrets(key));
      }
    }
    return keys;
  } catch {
    return null;
  }
}
