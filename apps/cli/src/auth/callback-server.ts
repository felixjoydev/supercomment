/**
 * Loopback callback server for `supercomment login`.
 *
 * The browser handoff (the gh/vercel/wrangler convention): `login` starts a
 * throwaway HTTP server on 127.0.0.1:<random>, opens the SuperComment web app's
 * `/cli-auth?port=<port>&state=<nonce>` page, the signed-in developer clicks
 * "Authorize CLI", and that page POSTs the session token (+ supabase url + anon
 * key) back to THIS server. The CLI then writes the binding.
 *
 * SECURITY (this is the boundary that protects the member JWT):
 *   - We bind 127.0.0.1 ONLY, so the callback is never reachable off-box.
 *   - The page is handed only a PORT (not a callback URL), so it can only ever
 *     POST to `http://127.0.0.1:<port>/callback` — there is no attacker-supplied
 *     destination to validate or spoof.
 *   - A random `state` nonce is generated per login, passed to the page, and
 *     echoed back in the POST body; a mismatch is rejected and never yields
 *     credentials (CSRF / stray-request guard), compared in constant time.
 *   - The request body is size-capped; the token is never logged.
 *   - CORS is scoped to the exact web origin we opened (browsers may only READ
 *     the response from that origin). The server is single-use: it stops after
 *     the first valid credential POST.
 *
 * The request LOGIC is a pure function (`handleCallbackRequest`) so the entire
 * validation surface is unit-tested without sockets; `startCallbackServer` is
 * the thin transport shell that wires it onto a real `http.Server`.
 */
import http, {
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";

/** Credentials the `/cli-auth` page returns to the CLI. */
export interface ReceivedCreds {
  /** The signed-in developer's Supabase access token (member session JWT). */
  token: string;
  /** Supabase project URL the token authenticates against. */
  supabaseUrl: string;
  /** Public anon/publishable key (the Supabase `apikey` the MCP client needs). */
  anonKey: string;
  /** Supabase refresh token, so the MCP server can renew the access token. */
  refreshToken?: string;
  /** Developer email, for a friendly "Logged in as …" line (optional). */
  email?: string;
}

/** Outcome of the pure request handler. `creds` is set only on a valid POST. */
export interface CallbackResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  creds?: ReceivedCreds;
}

/** The path the page POSTs to. Fixed so the page can build the URL from a port. */
export const CALLBACK_PATH = "/callback";

/** Max accepted callback body. A session token is ~1KB; 64KB is generous. */
export const MAX_CALLBACK_BODY_BYTES = 64 * 1024;

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** CORS headers scoping browser READ access to the one web origin we opened. */
function corsHeaders(allowOrigin: string): Record<string, string> {
  return {
    "access-control-allow-origin": allowOrigin,
    vary: "Origin",
  };
}

/**
 * Pure callback request handler. Decides the HTTP response (and whether valid
 * credentials were received) from the method, path, and body alone — no I/O.
 *
 * Accepts:
 *   OPTIONS /callback → 204 CORS preflight (the page POSTs application/json).
 *   POST    /callback → validate `state` + required fields → 200 + creds.
 * Everything else → 404. A bad/oversized/mismatched POST yields a 4xx and
 * NEVER returns creds.
 */
export function handleCallbackRequest(
  req: { method: string; path: string; body: string },
  opts: { state: string; allowOrigin: string },
): CallbackResponse {
  const cors = corsHeaders(opts.allowOrigin);

  if (req.path !== CALLBACK_PATH) {
    return { status: 404, headers: cors, body: "not found" };
  }

  if (req.method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        ...cors,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      },
      body: "",
    };
  }

  if (req.method !== "POST") {
    return { status: 405, headers: cors, body: "method not allowed" };
  }

  const json = (payload: unknown, status = 200): CallbackResponse => ({
    status,
    headers: { ...cors, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return json({ ok: false, error: "invalid payload" }, 400);
  }
  const p = parsed as Record<string, unknown>;

  // State nonce first: a forged/stray request must never reach field handling.
  if (typeof p.state !== "string" || !safeEqual(p.state, opts.state)) {
    return json({ ok: false, error: "state mismatch" }, 403);
  }

  const token = p.token;
  const supabaseUrl = p.supabaseUrl;
  const anonKey = p.anonKey;
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    typeof supabaseUrl !== "string" ||
    supabaseUrl.length === 0 ||
    typeof anonKey !== "string" ||
    anonKey.length === 0
  ) {
    return json(
      { ok: false, error: "missing token, supabaseUrl, or anonKey" },
      400,
    );
  }

  const creds: ReceivedCreds = {
    token,
    supabaseUrl,
    anonKey,
    ...(typeof p.refreshToken === "string" && p.refreshToken.length > 0
      ? { refreshToken: p.refreshToken }
      : {}),
    ...(typeof p.email === "string" && p.email.length > 0
      ? { email: p.email }
      : {}),
  };
  return { ...json({ ok: true }), creds };
}

/** A running loopback callback server. */
export interface CallbackServer {
  /** The OS-assigned loopback port the page must POST to. */
  port: number;
  /** Resolves with the credentials from the first valid POST, or rejects on timeout. */
  waitForCreds(timeoutMs?: number): Promise<ReceivedCreds>;
  /** Stop listening (idempotent). */
  close(): void;
}

export interface StartCallbackServerOptions {
  /** The per-login nonce the page must echo back. */
  state: string;
  /** The exact web origin we will open (CORS allow-origin). */
  allowOrigin: string;
  /** Loopback host. Defaults to 127.0.0.1 (never 0.0.0.0). */
  host?: string;
  /** Injectable server factory (tests pass a fake; default real http). */
  createServer?: (
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ) => http.Server;
}

/** Default per-login timeout: 5 minutes is plenty for a human to click. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Start the loopback callback server. Binds 127.0.0.1:0, returns once listening
 * with the assigned port. The single-use lifecycle: `waitForCreds` resolves on
 * the first valid POST (after which the server closes) or rejects on timeout.
 */
export async function startCallbackServer(
  opts: StartCallbackServerOptions,
): Promise<CallbackServer> {
  const host = opts.host ?? "127.0.0.1";
  const createServer =
    opts.createServer ?? ((h) => http.createServer(h));

  let resolveCreds: ((c: ReceivedCreds) => void) | undefined;
  let rejectCreds: ((e: Error) => void) | undefined;
  let settled = false;
  const credsPromise = new Promise<ReceivedCreds>((resolve, reject) => {
    resolveCreds = resolve;
    rejectCreds = reject;
  });

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      let body = "";
      try {
        body = await readBody(req, MAX_CALLBACK_BODY_BYTES);
      } catch {
        res.writeHead(413, corsHeaders(opts.allowOrigin));
        res.end("payload too large");
        return;
      }
      const out = handleCallbackRequest(
        { method: req.method ?? "GET", path, body },
        { state: opts.state, allowOrigin: opts.allowOrigin },
      );
      res.writeHead(out.status, out.headers);
      res.end(out.body);
      if (out.creds && !settled) {
        settled = true;
        resolveCreds?.(out.creds);
      }
    })();
  };

  const server = createServer(onRequest);

  const port = await new Promise<number>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(0, host, () => {
      server.removeListener("error", onError);
      const addr = server.address();
      resolve(addr && typeof addr === "object" ? addr.port : 0);
    });
  });

  // A server-level error after listen (e.g. socket failure) fails the wait.
  server.on("error", (err) => {
    if (!settled) {
      settled = true;
      rejectCreds?.(err instanceof Error ? err : new Error(String(err)));
    }
  });

  const close = (): void => {
    try {
      server.close();
    } catch {
      /* already closed */
    }
  };

  return {
    port,
    close,
    waitForCreds: (timeoutMs = DEFAULT_TIMEOUT_MS) => {
      const timeout = new Promise<never>((_, reject) => {
        const t = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(
              new Error(
                "Timed out waiting for browser authorization. Re-run " +
                  "`supercomment login` (or use --no-browser and open the URL " +
                  "manually).",
              ),
            );
          }
        }, timeoutMs);
        // Don't keep the event loop alive solely for this timer.
        if (typeof t.unref === "function") t.unref();
      });
      return Promise.race([credsPromise, timeout]).finally(close);
    },
  };
}

/** Read a request body into a string, rejecting if it exceeds `cap` bytes. */
function readBody(req: IncomingMessage, cap: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
