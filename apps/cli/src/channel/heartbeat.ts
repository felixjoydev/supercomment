/**
 * Heartbeat — keeps `previews.status` live while the helper is sharing, and
 * flips it offline exactly once when sharing stops.
 *
 * Outbound-only (R25): this is purely an OUTBOUND writer. The helper calls a
 * Supabase RPC (`preview_heartbeat`) on an interval; the backend never connects
 * inbound to the dev machine. U4 wires the real `previews` updater (the U2
 * `preview_heartbeat` / `preview_offline` security-definer RPCs); here we accept
 * the updater as an injected function so the loop logic is testable with no
 * network and no real timers.
 *
 * Lifecycle invariants (the testable core):
 *   - start():   immediately marks 'live', then marks 'live' on every tick.
 *   - stop():    marks 'offline' EXACTLY ONCE, never again on repeated stop().
 *   - a tick that fires after stop() is ignored (no resurrecting to 'live').
 */

/** The status the heartbeat reports for the bound preview. */
export type PreviewStatus = "live" | "offline";

/**
 * Pushes a status to the backend for one preview. In production this is the U2
 * RPC call (`preview_heartbeat` for 'live', `preview_offline' for 'offline').
 * It may reject; the heartbeat surfaces failures via `onError` and keeps going
 * so a transient network blip doesn't tear the session down.
 */
export type StatusUpdater = (status: PreviewStatus) => Promise<void>;

/**
 * Minimal injectable timer so tests drive ticks manually (no fake-timer global
 * patching). Defaults to Node's setInterval/clearInterval.
 */
export interface HeartbeatTimer {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

const defaultTimer: HeartbeatTimer = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface HeartbeatOptions {
  /** Pushes 'live'/'offline'. Required. */
  update: StatusUpdater;
  /** Heartbeat interval in ms. Defaults to 15s. */
  intervalMs?: number;
  /** Injectable timer (tests pass a manual one). */
  timer?: HeartbeatTimer;
  /**
   * Called when an updater push rejects. The loop continues regardless; this is
   * just for surfacing to the developer (stderr). The token is never included.
   */
  onError?: (status: PreviewStatus, error: unknown) => void;
}

/** Default heartbeat cadence. Comfortably under U4's stale-offline sweep. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * A start/stop heartbeat. Construct once per session; `start()` begins pushing
 * 'live', `stop()` pushes 'offline' once. Safe to `stop()` more than once.
 */
export class Heartbeat {
  private readonly update: StatusUpdater;
  private readonly intervalMs: number;
  private readonly timer: HeartbeatTimer;
  private readonly onError?: (status: PreviewStatus, error: unknown) => void;

  private handle: unknown = undefined;
  private started = false;
  private stopped = false;

  constructor(opts: HeartbeatOptions) {
    this.update = opts.update;
    this.intervalMs = opts.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.timer = opts.timer ?? defaultTimer;
    this.onError = opts.onError;
  }

  /** True once start() has run and stop() has not. */
  get isRunning(): boolean {
    return this.started && !this.stopped;
  }

  /**
   * Begin heartbeating. Pushes 'live' immediately (so status flips without
   * waiting a full interval), then on each tick. Idempotent: a second start()
   * while running is a no-op. A start() after stop() is refused (construct a new
   * Heartbeat for a new session).
   */
  start(): void {
    // Refuse a restart after stop() FIRST: once stopped, `started` is still
    // true, so this check must precede the idempotency early-return. Construct a
    // fresh Heartbeat for a new session.
    if (this.stopped) {
      throw new Error("Heartbeat cannot be restarted after stop().");
    }
    if (this.started) return;
    this.started = true;
    // Fire one immediately so 'live' is visible without waiting an interval.
    this.tick();
    this.handle = this.timer.setInterval(() => this.tick(), this.intervalMs);
  }

  private tick(): void {
    // A tick that fires after stop() must not resurrect the preview to 'live'.
    if (this.stopped) return;
    void this.push("live");
  }

  /**
   * Stop heartbeating and mark 'offline' EXACTLY ONCE. Idempotent: repeated
   * calls do nothing (no duplicate 'offline' pushes), satisfying the U5 test.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.handle !== undefined) {
      this.timer.clearInterval(this.handle);
      this.handle = undefined;
    }
    // Only push the terminal 'offline' if we ever started; stopping a heartbeat
    // that never started should not emit a spurious 'offline'.
    if (this.started) {
      void this.push("offline");
    }
  }

  private async push(status: PreviewStatus): Promise<void> {
    try {
      await this.update(status);
    } catch (error) {
      this.onError?.(status, error);
    }
  }
}
