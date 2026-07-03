import { randomBytes } from 'node:crypto';
import { classifyDeployUrl } from './external-redirect';

/**
 * Pure link-management logic for previews. Kept free of React / Next / Supabase
 * imports so it is unit-testable without a running server or browser. The route
 * handler (app/api/previews/[id]/route.ts) applies the patch this module
 * computes via an RLS-scoped UPDATE.
 */

/** Preview access modes (mirrors the previews.access_mode CHECK in 0001). */
export type AccessMode = 'team_only' | 'guest_link';

/** Minimum length of a generated guest-link secret (R24). */
export const LINK_SECRET_MIN_LENGTH = 16;

/**
 * Number of random bytes for a secret. base64url of N bytes yields
 * ceil(N*4/3) chars; 24 bytes → 32 chars, comfortably above the 16-char floor
 * and ~192 bits of entropy.
 */
const LINK_SECRET_BYTES = 24;

/** The fields a link action may change on a preview row. */
export interface LinkPatch {
  name?: string;
  access_mode?: AccessMode;
  link_secret?: string | null;
  expires_at?: string | null;
  /**
   * Validated deploy URL for embedded mode. Written through the
   * register_deploy_target RPC (not a direct UPDATE) so the allowlist is
   * enforced server-side; computeLinkPatch only validates + normalizes it here.
   */
  deploy_url?: string;
}

/**
 * The link-relevant state of a preview, as read from the DB. `name` is included
 * because `computeLinkPatch` may need to validate/return it, but the validity
 * helpers (isGuestLinkValid, buildGuestUrl) only need the access/secret/expiry
 * subset — see GuestLinkState.
 */
export interface PreviewLinkState {
  name: string;
  access_mode: AccessMode;
  link_secret: string | null;
  expires_at: string | null;
}

/** The subset needed to decide whether a guest link is currently usable. */
export type GuestLinkState = Pick<
  PreviewLinkState,
  'access_mode' | 'link_secret' | 'expires_at'
>;

/** Discriminated union of supported link-management actions. */
export type LinkAction =
  | { type: 'rename'; name: string }
  | { type: 'set_access_mode'; accessMode: AccessMode }
  | { type: 'regenerate' }
  | { type: 'revoke' }
  | { type: 'set_expiry'; expiresAt: string | null }
  | { type: 'set_deploy_url'; deployUrl: string };

/**
 * Generate a cryptographically-random, URL-safe guest-link secret of at least
 * LINK_SECRET_MIN_LENGTH characters (R24). Uses node:crypto randomBytes.
 */
export function generateLinkSecret(): string {
  // base64url avoids +,/,= so the secret is safe in a URL path/query.
  const secret = randomBytes(LINK_SECRET_BYTES).toString('base64url');
  // base64url of 24 bytes is already 32 chars, but guard the invariant.
  return secret.length >= LINK_SECRET_MIN_LENGTH
    ? secret
    : secret.padEnd(LINK_SECRET_MIN_LENGTH, '0');
}

/**
 * Validate an untrusted request body into a well-formed {@link LinkAction}.
 *
 * The PATCH route receives arbitrary JSON; without this a body like
 * `{ type: 'rename' }` (no `name`) slips through a bare `as LinkAction` cast and
 * blows up in computeLinkPatch (`action.name.trim()` on undefined) as an
 * unhandled 500. Here every variant's payload is shape-checked, so a malformed
 * body throws LinkActionError → the route returns 400. Deeper SEMANTIC checks
 * (non-empty name, allowlisted deploy URL, valid expiry) stay in computeLinkPatch.
 */
export function parseLinkAction(input: unknown): LinkAction {
  if (!input || typeof input !== 'object') {
    throw new LinkActionError('Invalid or unknown action');
  }
  const record = input as Record<string, unknown>;
  switch (record.type) {
    case 'rename': {
      if (typeof record.name !== 'string') {
        throw new LinkActionError('rename requires a name');
      }
      return { type: 'rename', name: record.name };
    }
    case 'set_access_mode': {
      if (record.accessMode !== 'team_only' && record.accessMode !== 'guest_link') {
        throw new LinkActionError(
          'set_access_mode requires accessMode of "team_only" or "guest_link"',
        );
      }
      return { type: 'set_access_mode', accessMode: record.accessMode };
    }
    case 'regenerate':
      return { type: 'regenerate' };
    case 'revoke':
      return { type: 'revoke' };
    case 'set_expiry': {
      if (record.expiresAt !== null && typeof record.expiresAt !== 'string') {
        throw new LinkActionError(
          'set_expiry requires expiresAt (an ISO string or null)',
        );
      }
      return { type: 'set_expiry', expiresAt: record.expiresAt };
    }
    case 'set_deploy_url': {
      if (typeof record.deployUrl !== 'string') {
        throw new LinkActionError('set_deploy_url requires deployUrl');
      }
      return { type: 'set_deploy_url', deployUrl: record.deployUrl };
    }
    default:
      throw new LinkActionError('Invalid or unknown action');
  }
}

/**
 * Compute the DB patch for a link action against the preview's current state.
 *
 * Rules:
 *   - rename: sets name (trimmed, must be non-empty).
 *   - set_access_mode:
 *       * → guest_link: ensure a secret exists (mint one if missing).
 *       * → team_only: keep the secret as-is (toggling back on reuses it);
 *         use `revoke` to actually destroy the secret.
 *   - regenerate: rotate to a brand-new secret; only valid when guest access is
 *     (or is being kept) enabled. The OLD secret stops matching immediately.
 *   - revoke: clear the secret AND force access back to team_only, so the guest
 *     link is dead and cannot be silently re-enabled with the old secret.
 *   - set_expiry: set or clear expires_at (ISO string or null).
 *   - set_deploy_url: validate the embedded-mode deploy URL against the shared
 *     allowlist (isAllowedDeployUrl) and return the normalized value. The route
 *     writes it via the register_deploy_target RPC, which re-validates — this is
 *     the UX/early-validation half of that defense-in-depth pair.
 *
 * Throws on invalid input so the caller returns a 400.
 */
export function computeLinkPatch(action: LinkAction, current: PreviewLinkState): LinkPatch {
  switch (action.type) {
    case 'rename': {
      const name = action.name.trim();
      if (!name) throw new LinkActionError('Name cannot be empty');
      if (name.length > 120) throw new LinkActionError('Name too long');
      return { name };
    }

    case 'set_access_mode': {
      if (action.accessMode === 'guest_link') {
        // Enabling guest access requires a live secret; mint one if absent.
        const link_secret = current.link_secret ?? generateLinkSecret();
        return { access_mode: 'guest_link', link_secret };
      }
      // Back to team_only: keep the existing secret (revoke destroys it).
      return { access_mode: 'team_only' };
    }

    case 'regenerate': {
      // Rotate the secret; this is the "destructive" action that invalidates
      // any link already shared. Ensure access stays guest_link.
      return { access_mode: 'guest_link', link_secret: generateLinkSecret() };
    }

    case 'revoke': {
      // Kill the guest link entirely: null the secret + drop to team_only.
      return { access_mode: 'team_only', link_secret: null };
    }

    case 'set_expiry': {
      if (action.expiresAt === null) return { expires_at: null };
      const ts = new Date(action.expiresAt);
      if (Number.isNaN(ts.getTime())) {
        throw new LinkActionError('Invalid expiry timestamp');
      }
      return { expires_at: ts.toISOString() };
    }

    case 'set_deploy_url': {
      const raw = typeof action.deployUrl === 'string' ? action.deployUrl.trim() : '';
      const verdict = classifyDeployUrl(raw);
      if (!verdict.ok) throw new LinkActionError(verdict.message);
      return { deploy_url: raw };
    }

    default: {
      // Exhaustiveness guard.
      const _never: never = action;
      throw new LinkActionError(`Unknown action: ${JSON.stringify(_never)}`);
    }
  }
}

/**
 * Whether a guest link is currently usable for the given preview state at
 * `now`. Mirrors the DB-side checks in create_guest_comment (access mode,
 * secret presence, expiry). Used to derive UI (show/hide the guest URL) and is
 * the unit-test oracle for "revoke invalidates the link" / "expired link".
 */
export function isGuestLinkValid(state: GuestLinkState, now: Date = new Date()): boolean {
  if (state.access_mode !== 'guest_link') return false;
  if (!state.link_secret) return false;
  if (isExpired(state.expires_at, now)) return false;
  return true;
}

/** True when `expiresAt` is set and is at/before `now`. */
export function isExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const ts = new Date(expiresAt);
  if (Number.isNaN(ts.getTime())) return false;
  return ts.getTime() <= now.getTime();
}

/** Build the public guest URL for a preview's slug + secret (or null). */
export function buildGuestUrl(
  baseUrl: string,
  slug: string,
  state: GuestLinkState,
  now: Date = new Date(),
): string | null {
  if (!isGuestLinkValid(state, now)) return null;
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/s/${slug}?k=${state.link_secret}`;
}

/** Thrown for invalid link-management input (caller maps to HTTP 400). */
export class LinkActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkActionError';
  }
}
