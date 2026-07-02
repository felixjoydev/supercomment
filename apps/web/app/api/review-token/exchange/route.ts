import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Review-token exchange endpoint (U3) — the cross-origin half of the embedded
 * activation flow.
 *
 * The overlay (embedded on the customer's DEPLOY origin) calls this after an
 * anonymous Supabase sign-in:
 *   POST /api/review-token/exchange
 *   Authorization: Bearer <anon access JWT>
 *   { "token": "<single-use review token from the /s fragment>" }
 *
 * We VERIFY the bearer (→ the anon uid), then call establish_review_session
 * (0019) with an anon-key client (the RPC is SECURITY DEFINER). On success we
 * return { previewId, role, displayName }; the overlay persists the session and
 * mounts. Writes then go through create_review_comment via the same anon JWT.
 *
 * CORS: this is a bearer-authenticated endpoint with NO cookies, so reflecting
 * the request Origin in Access-Control-Allow-Origin is safe (no ambient-auth /
 * CSRF surface). We reflect dynamically + set `Vary: Origin`. (Tightening this
 * to the deploy-URL allowlist is a hardening follow-up; bearer-only means a
 * forged origin gains nothing without a valid anon JWT + unused token.)
 *
 * U4 HARDENING — TURNSTILE AT SESSION MINT: before establishing the session we
 * require + verify a Cloudflare Turnstile token (body field `turnstileToken`)
 * against the siteverify API using TURNSTILE_SECRET_KEY. This throttles
 * automated anonymous-session minting (each guest does an anon sign-in, so the
 * mint is the abuse choke point). DEV/DEMO DEGRADATION: when TURNSTILE_SECRET_KEY
 * is UNSET we SKIP verification with a console note, so local dev/demos keep
 * working without provisioning Turnstile keys.
 *
 * VERIFY IN REAL ENV: live JWT verification (auth.getUser), the
 * establish_review_session round-trip, the real cross-origin preflight from a
 * customer deploy, and the live Turnstile siteverify call cannot be exercised in
 * this sandbox.
 *
 * REAL-ENV FLAGS:
 *   * TURNSTILE_SECRET_KEY (server-only) — when set, exchange requires a valid
 *     Turnstile token; when unset, verification is skipped (dev).
 *   * The overlay must be configured with the matching site key
 *     (window.__SUPERCOMMENT__.turnstileSiteKey, e.g. from
 *     NEXT_PUBLIC_TURNSTILE_SITE_KEY) so it can produce the token.
 */

export const dynamic = "force-dynamic";

/** Cloudflare Turnstile server-side verification endpoint. */
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile token server-side via siteverify (raw fetch — no SDK).
 * Returns true only on `success`. Any network/parse failure → false (fail
 * closed). Best-effort `remoteip` is included when a client IP header is present.
 */
async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp: string | null,
): Promise<boolean> {
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (remoteIp) form.set("remoteip", remoteIp);
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data?.success === true;
  } catch {
    return false;
  }
}

/** Bearer-auth + no cookies → reflecting the request Origin is safe. */
function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    vary: "Origin",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function jsonError(
  error: string,
  status: number,
  cors: Record<string, string>,
): Response {
  return NextResponse.json({ error }, { status, headers: cors });
}

export function OPTIONS(request: NextRequest): Response {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: NextRequest): Promise<Response> {
  const cors = corsHeaders(request.headers.get("origin"));

  // ---- Bearer (the anon access token) ------------------------------------
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim();
  if (!bearer) {
    return jsonError("missing_bearer", 401, cors);
  }

  // ---- Body: { token } ----------------------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const token =
    body && typeof body === "object" && typeof (body as { token?: unknown }).token === "string"
      ? (body as { token: string }).token.trim()
      : "";
  if (!token) {
    return jsonError("missing_token", 400, cors);
  }
  const turnstileToken =
    body &&
    typeof body === "object" &&
    typeof (body as { turnstileToken?: unknown }).turnstileToken === "string"
      ? (body as { turnstileToken: string }).turnstileToken.trim()
      : "";

  // ---- Turnstile (U4) -----------------------------------------------------
  // When the secret is configured, require + verify a Turnstile token before we
  // mint a session. When it is UNSET (local dev / demo), skip with a clear note.
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (turnstileSecret) {
    const remoteIp =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for");
    const passed = await verifyTurnstile(turnstileToken, turnstileSecret, remoteIp);
    if (!passed) {
      return jsonError("turnstile_failed", 403, cors);
    }
  } else {
    console.warn(
      "[review-token/exchange] TURNSTILE_SECRET_KEY unset — skipping Turnstile verification (dev/demo only).",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return jsonError("server_misconfigured", 500, cors);
  }

  // ---- Verify the JWT → anon uid -----------------------------------------
  // getUser(jwt) validates the token against the auth server and returns its
  // user; this is the authoritative binding of the request to an anon identity.
  const verifyClient = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } =
    await verifyClient.auth.getUser(bearer);
  const anonUid = userData?.user?.id;
  if (userError || !anonUid) {
    return jsonError("invalid_jwt", 401, cors);
  }

  // ---- Consume the token + open the session ------------------------------
  // The RPC is SECURITY DEFINER; an anon-key client is sufficient (and the RPC
  // is granted to anon). p_anon_user_id is the JUST-VERIFIED uid.
  const anonClient = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anonClient.rpc("establish_review_session", {
    p_token: token,
    p_anon_user_id: anonUid,
  });

  if (error) {
    const message = (error.message ?? "").toLowerCase();
    if (message.includes("invalid_token")) {
      return jsonError("invalid_token", 403, cors);
    }
    return jsonError("exchange_failed", 400, cors);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        preview_id?: string;
        role?: string;
        display_name?: string;
        can_send_to_agent?: boolean;
      }
    | undefined;
  if (!row?.preview_id) {
    return jsonError("exchange_failed", 400, cors);
  }

  return NextResponse.json(
    {
      previewId: row.preview_id,
      role: row.role ?? "guest",
      displayName: row.display_name ?? "Guest",
      // Phase 2: a MEMBER session may carry send-to-agent; establish_review_session
      // computes it from the token's member (guests always get false).
      canSendToAgent: row.can_send_to_agent === true,
    },
    { status: 200, headers: cors },
  );
}
