/**
 * Cloudflared QUICK tunnel control (U4).
 *
 * A quick tunnel is the frictionless path the product promises (R1 "one
 * command, no account"): `cloudflared tunnel --url http://localhost:<port>`
 * mints a random `https://<random>.trycloudflare.com` URL with NO account,
 * login, or owned domain. We spawn that process, parse the minted URL from its
 * output, and resolve with it.
 *
 * Quick-tunnel limits (research-confirmed, May 2026): no SSE, ~200 in-flight
 * request cap, the URL rotates each session. That is fine here — realtime is
 * WebSocket (Supabase Realtime) and the stable address is provided by the
 * backend registry (U4 `registerTunnel`), not the tunnel itself.
 *
 * TESTABILITY: the actual `child_process.spawn` is injected via `SpawnFn` so the
 * URL-parse, lifecycle, and ENOENT handling are unit-tested against a fake child
 * process with no `cloudflared` binary present (it is not in this sandbox). The
 * default spawn that shells out to the real binary is marked
 * `// VERIFY IN REAL ENV:`.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

/**
 * The minimal child-process surface the tunnel needs. The real Node
 * `ChildProcess` satisfies it; tests pass a fake emitter.
 */
export interface TunnelChildProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  /** 'error' (spawn failure, e.g. ENOENT) and 'exit' are the ones we use. */
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  /** Send a signal to terminate the tunnel. */
  kill(signal?: NodeJS.Signals): boolean;
}

/** Injectable spawn so tests don't require the cloudflared binary. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
) => TunnelChildProcess;

/**
 * VERIFY IN REAL ENV: spawns the real `cloudflared` binary. The argv shape
 * (`tunnel --url http://localhost:<port>`) and that the trycloudflare URL is
 * emitted on stderr/stdout are confirmed by research but cannot run here (no
 * binary in the sandbox). The parse/lifecycle logic below is what the tests
 * cover; this just connects it to the OS.
 */
const defaultSpawn: SpawnFn = (command, args) =>
  spawn(command, [...args], {
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as ChildProcess as TunnelChildProcess;

/** A started tunnel: the public URL plus a way to tear it down. */
export interface ActiveTunnel {
  /** The minted `https://<random>.trycloudflare.com` URL. */
  url: string;
  /** Kill the underlying cloudflared process. Idempotent. */
  stop(): void;
}

/** A provider that can stand up a tunnel in front of a local port. */
export interface TunnelProvider {
  /** Start a tunnel pointing at http://localhost:<port>; resolve with the URL. */
  start(port: number): Promise<ActiveTunnel>;
}

export interface CloudflaredOptions {
  /** Injectable spawn (tests). Defaults to spawning the real binary. */
  spawnFn?: SpawnFn;
  /** Override the binary name/path. Defaults to "cloudflared". */
  binary?: string;
  /**
   * How long to wait for the URL to appear before giving up. Defaults to 30s.
   */
  startupTimeoutMs?: number;
}

/**
 * Matches the trycloudflare URL cloudflared prints once the quick tunnel is up,
 * e.g. `https://brave-tiger-foo-bar.trycloudflare.com`. We accept it anywhere on
 * a line (cloudflared boxes it in an ASCII banner).
 */
const TRYCLOUDFLARE_URL =
  /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

/**
 * Cloudflared quick-tunnel provider.
 *
 * `start(port)`:
 *   - spawns `cloudflared tunnel --url http://localhost:<port>`
 *   - scans stdout AND stderr for the trycloudflare URL (cloudflared has
 *     historically printed it to stderr; we watch both to be robust)
 *   - resolves with `{ url, stop() }` on the first match
 *   - rejects on:
 *       * spawn 'error' with code ENOENT -> actionable "install cloudflared"
 *       * the process exiting before any URL was seen
 *       * the startup timeout elapsing before any URL was seen
 *   - always tears the process down on a rejection so we never leak a child.
 */
export class CloudflaredTunnel implements TunnelProvider {
  private readonly spawnFn: SpawnFn;
  private readonly binary: string;
  private readonly startupTimeoutMs: number;

  constructor(opts: CloudflaredOptions = {}) {
    this.spawnFn = opts.spawnFn ?? defaultSpawn;
    this.binary = opts.binary ?? "cloudflared";
    this.startupTimeoutMs = opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  }

  start(port: number): Promise<ActiveTunnel> {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return Promise.reject(new Error(`Invalid port: ${port}`));
    }

    const args = ["tunnel", "--url", `http://localhost:${port}`];
    const child = this.spawnFn(this.binary, args);

    return new Promise<ActiveTunnel>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanupListeners = (): void => {
        if (timer) clearTimeout(timer);
      };

      /** Kill the child without throwing (it may already be gone). */
      const killChild = (): void => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already dead */
        }
      };

      const succeed = (url: string): void => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        let stopped = false;
        resolve({
          url,
          stop: () => {
            if (stopped) return;
            stopped = true;
            killChild();
          },
        });
      };

      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        killChild();
        reject(err);
      };

      const scan = (buf: Buffer | string): void => {
        const text = typeof buf === "string" ? buf : buf.toString("utf8");
        const match = TRYCLOUDFLARE_URL.exec(text);
        if (match) succeed(match[0]);
      };

      child.stdout?.on("data", scan);
      child.stderr?.on("data", scan);

      child.on("error", (err: Error) => {
        // ENOENT: the binary isn't installed. Give an actionable message.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          fail(
            new Error(
              "cloudflared not found — run: brew install cloudflared " +
                "(or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)",
            ),
          );
          return;
        }
        fail(new Error(`cloudflared failed to start: ${err.message}`));
      });

      child.on("exit", (exitCode: number | null) => {
        // Exiting before we ever saw a URL means the tunnel never came up.
        fail(
          new Error(
            `cloudflared exited (code ${exitCode ?? "null"}) before a tunnel ` +
              "URL was established.",
          ),
        );
      });

      timer = setTimeout(() => {
        fail(
          new Error(
            `cloudflared did not produce a tunnel URL within ` +
              `${this.startupTimeoutMs}ms.`,
          ),
        );
      }, this.startupTimeoutMs);
      // Don't keep the event loop alive solely for this timer.
      if (typeof timer.unref === "function") timer.unref();
    });
  }
}
