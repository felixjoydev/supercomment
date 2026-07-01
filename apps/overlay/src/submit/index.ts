/**
 * SupabaseCommentSubmitter (U4) — the real overlay submitter that closes the
 * loop: a reviewer's annotation becomes a row in Supabase via the guest-write
 * security-definer RPC `create_guest_comment` (R23/R24 choke point).
 *
 * The overlay runs INSIDE the host page, injected by the proxy (U3). The proxy's
 * boot script (U4 `start`) sets `window.__SUPERCOMMENT__` with the supabase URL,
 * anon key, and the preview link secret. This submitter reads that config and
 * calls the RPC.
 *
 * WHY fetch, not @supabase/supabase-js: the overlay is built to a single
 * self-contained IIFE injected into arbitrary pages. Pulling the full Supabase
 * SDK into that bundle would bloat it and risk colliding with a host app that
 * already ships supabase-js. The guest path only needs ONE PostgREST RPC POST,
 * so we issue it directly with `fetch` (anon key + apikey headers). The HTTP
 * call is injected (`RpcCaller`) so the arg-building logic is unit-tested with a
 * mock and the live network call is isolated.
 *
 * VERIFY IN REAL ENV: the live PostgREST RPC round-trip (auth headers, anon
 * sign-in for guest identity, CORS from the proxied origin) cannot run in this
 * sandbox; the default `fetch` caller is marked below. The arg-mapping +
 * result-mapping logic is what the tests cover.
 */
import type { NewCommentInput } from "@supercomment/shared";
import type { CommentSubmitter, SubmitResult } from "../core/types.js";

/** Boot config injected onto the page before the overlay runs. */
export interface OverlayBootConfig {
  previewId?: string;
  previewKey?: string;
  /**
   * TUNNEL MODE: guest link secret passed to `create_guest_comment` (R24). Its
   * presence selects the tunnel write path (SupabaseCommentSubmitter). Embedded
   * review mode (U3) has no link secret — it authorizes via a session JWT.
   */
  linkSecret?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /**
   * EMBEDDED MODE (U3): the SuperComment backend origin the overlay POSTs the
   * review-token exchange to (cross-origin). Unused in tunnel mode.
   */
  backendOrigin?: string;
}

/**
 * The exact positional argument shape `create_guest_comment` expects. Mirrors
 * `supabase/migrations/0003_rpcs.sql`:
 *   create_guest_comment(p_link_secret, p_path, p_display_name, p_intent,
 *                        p_severity, p_note, p_context jsonb, p_fidelity)
 */
export interface CreateGuestCommentArgs {
  p_link_secret: string;
  p_path: string;
  p_display_name: string;
  p_intent: string;
  p_severity: string;
  p_note: string;
  p_context: unknown;
  p_fidelity: string;
}

/** The fields we read off the RPC's returned `comments` row. */
export interface CreatedCommentRow {
  id?: string;
  number?: number;
}

/**
 * Calls a Supabase RPC by name with the given args and returns the result row.
 * Injectable: tests pass a mock; production uses the fetch caller below.
 */
export type RpcCaller = (
  fn: string,
  args: CreateGuestCommentArgs,
) => Promise<CreatedCommentRow>;

export interface SupabaseCommentSubmitterConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  linkSecret: string;
  /** Override the RPC caller (tests). Defaults to a fetch-based PostgREST call. */
  rpc?: RpcCaller;
  /** Override the page-path resolver (tests). Defaults to location.pathname. */
  currentPath?: () => string;
}

export class SupabaseCommentSubmitter implements CommentSubmitter {
  private readonly linkSecret: string;
  private readonly rpc: RpcCaller;
  private readonly currentPath: () => string;

  constructor(config: SupabaseCommentSubmitterConfig) {
    if (!config.linkSecret) {
      throw new Error("SupabaseCommentSubmitter requires a link secret.");
    }
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error(
        "SupabaseCommentSubmitter requires a supabaseUrl and anon key.",
      );
    }
    this.linkSecret = config.linkSecret;
    this.rpc =
      config.rpc ??
      makeFetchRpcCaller(config.supabaseUrl, config.supabaseAnonKey);
    this.currentPath =
      config.currentPath ??
      (() => (typeof location !== "undefined" ? location.pathname : "/"));
  }

  async submit(payload: NewCommentInput): Promise<SubmitResult> {
    const args = this.buildArgs(payload);
    try {
      const row = await this.rpc("create_guest_comment", args);
      if (typeof row.number !== "number") {
        return {
          ok: false,
          number: 0,
          message: "Server did not return a comment number.",
        };
      }
      return {
        ok: true,
        number: row.number,
        ...(row.id ? { id: row.id } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        number: 0,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Map a `NewCommentInput` to the RPC's positional arguments.
   *
   * NOTE: the legacy tunnel RPC `create_guest_comment` has no `p_kind` (0026 only
   * added it to the embedded `create_review_comment`), so a `template` saved on
   * the tunnel path is persisted as `comment` — its change-set still rides
   * `context` and reaches the agent, but it won't get the dashboard/marker
   * Template treatment. Embedded review mode (the primary path) labels it.
   */
  buildArgs(payload: NewCommentInput): CreateGuestCommentArgs {
    return {
      p_link_secret: this.linkSecret,
      p_path: this.currentPath(),
      p_display_name: payload.authorDisplayName,
      p_intent: payload.intent,
      p_severity: payload.severity,
      p_note: payload.note,
      p_context: payload.context,
      p_fidelity: payload.fidelity ?? "live",
    };
  }
}

/**
 * VERIFY IN REAL ENV: the live PostgREST RPC POST. Supabase exposes RPCs at
 * `<url>/rest/v1/rpc/<fn>`; the body is the named-arg object. We send the anon
 * key as both `apikey` and `Authorization` (the guest path; an anonymous
 * session JWT would replace the bearer in a fuller flow). The RPC returns the
 * inserted `comments` row (or a single-element array depending on Accept).
 */
function makeFetchRpcCaller(
  supabaseUrl: string,
  anonKey: string,
): RpcCaller {
  const base = supabaseUrl.replace(/\/+$/, "");
  return async (fn, args) => {
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        // Ask PostgREST to return the inserted row as a single object.
        Accept: "application/vnd.pgrst.object+json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `create_guest_comment failed (${res.status}): ${text || res.statusText}`,
      );
    }
    const data = (await res.json()) as CreatedCommentRow | CreatedCommentRow[];
    return Array.isArray(data) ? (data[0] ?? {}) : data;
  };
}

/**
 * Build a `SupabaseCommentSubmitter` from the page's injected boot config, or
 * return undefined if the config is incomplete (so the caller can fall back to
 * the stub during standalone/dev use).
 */
export function submitterFromBootConfig(
  boot: OverlayBootConfig | undefined,
): SupabaseCommentSubmitter | undefined {
  if (
    !boot ||
    !boot.linkSecret ||
    !boot.supabaseUrl ||
    !boot.supabaseAnonKey
  ) {
    return undefined;
  }
  return new SupabaseCommentSubmitter({
    supabaseUrl: boot.supabaseUrl,
    supabaseAnonKey: boot.supabaseAnonKey,
    linkSecret: boot.linkSecret,
  });
}
