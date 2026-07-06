/**
 * Overlay realtime subscription — the LIVE half of embedded review mode.
 *
 * The overlay reads comments once at activation and then keeps them fresh two
 * ways: a background poll (controller) as a resilient fallback, and THIS live
 * subscription for instant updates. It joins the SAME per-preview private
 * broadcast topic the dashboard uses (`preview:<id>`), fed by the DB triggers in
 * migrations 0004 + 0038 (comment INSERT/UPDATE/DELETE and reply INSERT/DELETE).
 *
 * Authorization: the private channel is gated by the RLS policy on
 * realtime.messages (0004), which — as of 0040 — also authorizes a caller with an
 * ACTIVE review session for the preview. realtime-js is given an `accessToken`
 * callback (the reviewer's anon SESSION JWT, refreshed near expiry), so the socket
 * re-authorizes itself on connect / reconnect / token rotation.
 *
 * We deliberately DON'T merge the broadcast payload here (unlike the dashboard):
 * on ANY change the overlay just re-reads via `list_review_comments` and diffs the
 * pins, and refreshes an open thread's replies. That reuses the authorized,
 * unit-tested read + diff path and keeps this module a thin, side-effect-only glue.
 *
 * VERIFY IN REAL ENV: the live websocket handshake (join, private-topic RLS,
 * broadcast delivery) cannot run in this sandbox; only the wiring is typed here.
 */
import { RealtimeClient } from "@supabase/realtime-js";

export interface PreviewChangesSubscription {
  /** Tear down the channel + socket (idempotent, never throws). */
  close(): void;
}

export interface SubscribePreviewChangesConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** The preview whose broadcast topic to join (`preview:<id>`). */
  previewId: string;
  /**
   * Returns the current (refreshed-near-expiry) anon SESSION JWT. realtime-js
   * calls it to authorize the private topic and again on reconnect / rotation.
   */
  getAccessToken: () => string | Promise<string>;
  /** Fired on every comment/reply change on the preview. Coalesce + re-read. */
  onChange: () => void;
  /** Optional connection-status hook: SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED. */
  onStatus?: (status: string) => void;
}

/**
 * Subscribe to a preview's live comment/reply changes. Never throws: a socket
 * that cannot connect (blocked, offline, RLS-rejected) simply never fires
 * `onChange`, and the controller's background poll keeps the overlay fresh.
 */
export function subscribePreviewChanges(
  config: SubscribePreviewChangesConfig,
): PreviewChangesSubscription {
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const client = new RealtimeClient(`${base}/realtime/v1`, {
    params: { apikey: config.supabaseAnonKey },
    // realtime-js pulls the bearer for the private topic from here, and re-pulls
    // it on reconnect / resubscribe, so a rotated session token keeps authorizing.
    accessToken: async () => {
      try {
        return await config.getAccessToken();
      } catch {
        return null;
      }
    },
  });

  const channel = client.channel(`preview:${config.previewId}`, {
    config: { private: true },
  });

  // broadcast_changes emits the DB operation as the event name; any of them means
  // "something on this preview changed, re-read". We don't parse the payload.
  const trigger = (): void => config.onChange();
  channel
    .on("broadcast", { event: "INSERT" }, trigger)
    .on("broadcast", { event: "UPDATE" }, trigger)
    .on("broadcast", { event: "DELETE" }, trigger)
    .subscribe((status: string) => config.onStatus?.(status));

  return {
    close() {
      try {
        void client.removeChannel(channel);
      } catch {
        /* already gone */
      }
      try {
        void client.disconnect();
      } catch {
        /* already gone */
      }
    },
  };
}
