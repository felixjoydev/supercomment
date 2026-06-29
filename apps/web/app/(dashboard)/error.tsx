'use client';

/**
 * Dashboard error boundary. RLS denials surface as query errors; rather than a
 * blank screen we show a recoverable message.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="error-box">
      <h2>Something went wrong</h2>
      <p>{error.message || 'Failed to load this view.'}</p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
