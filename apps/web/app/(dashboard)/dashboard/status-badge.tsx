import type { PreviewStatus } from '@/lib/status';

/**
 * Live/offline status pill (D-14). Status is derived server-side
 * (deriveStatus) from previews.status + last_heartbeat_at; this is presentation
 * only. Server component — no interactivity (the live pulse is pure CSS).
 */
export function StatusBadge({ status }: { status: PreviewStatus }) {
  const isLive = status === 'live';
  return (
    <span
      className={isLive ? 'status-pill is-live' : 'status-pill is-offline'}
      role="status"
      aria-label={isLive ? 'Live' : 'Offline'}
    >
      <span className="status-dot" aria-hidden="true" />
      {isLive ? 'Live' : 'Offline'}
    </span>
  );
}
