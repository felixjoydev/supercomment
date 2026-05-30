/**
 * Pure live/offline status derivation for previews (D-14, AE7).
 *
 * The dashboard READS previews.status + previews.last_heartbeat_at and derives
 * a display status. Heartbeat WRITES come from the U4/U5 CLI (not built yet);
 * U8 only consumes them. Kept dependency-free so it is unit-testable.
 */

/** Stored preview status (previews.status CHECK in 0001). */
export type PreviewDbStatus = 'live' | 'offline';

/** Derived display status. */
export type PreviewStatus = 'live' | 'offline';

/**
 * How recent a heartbeat must be for a preview to count as live. The CLI is
 * expected to beat well within this window; a missed window flips to offline.
 */
export const HEARTBEAT_STALE_MS = 60_000;

export interface StatusInput {
  /** The stored status flag (live|offline). */
  dbStatus: PreviewDbStatus;
  /** ISO timestamp of the last heartbeat, or null if none yet. */
  lastHeartbeatAt: string | null;
  /** Injectable clock for testing. */
  now?: Date;
}

/**
 * Derive the display status:
 *   - If the stored status is 'offline', it's offline (the CLI explicitly went
 *     offline, e.g. on clean shutdown).
 *   - If 'live' but there has been no heartbeat, or the last one is older than
 *     HEARTBEAT_STALE_MS, treat as offline (stale / crashed session).
 *   - Otherwise live.
 */
export function deriveStatus(input: StatusInput): PreviewStatus {
  if (input.dbStatus !== 'live') return 'offline';

  const { lastHeartbeatAt } = input;
  if (!lastHeartbeatAt) return 'offline';

  const beat = new Date(lastHeartbeatAt);
  if (Number.isNaN(beat.getTime())) return 'offline';

  const now = input.now ?? new Date();
  const age = now.getTime() - beat.getTime();
  if (age > HEARTBEAT_STALE_MS) return 'offline';
  return 'live';
}
