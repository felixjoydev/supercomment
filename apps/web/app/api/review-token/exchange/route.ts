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
 * VERIFY IN REAL ENV: live JWT verification (auth.getUser), the
 * establish_review_session round-trip, and the real cross-origin preflight from
 * a customer deploy cannot be exercised in this sandbox.
 */

export const dynamic = "force-dynamic";

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
    | { preview_id?: string; role?: string; display_name?: string }
    | undefined;
  if (!row?.preview_id) {
    return jsonError("exchange_failed", 400, cors);
  }

  return NextResponse.json(
    {
      previewId: row.preview_id,
      role: row.role ?? "guest",
      displayName: row.display_name ?? "Guest",
    },
    { status: 200, headers: cors },
  );
}
