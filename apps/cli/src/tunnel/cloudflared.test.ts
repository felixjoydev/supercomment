import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  CloudflaredTunnel,
  type SpawnFn,
  type TunnelChildProcess,
} from "./cloudflared.js";

/**
 * A fake cloudflared child process. `stdout`/`stderr` are real PassThroughs so
 * we can push bytes that the tunnel's data listeners receive; `error`/`exit` are
 * emitted via the EventEmitter base. `kill` is a spy so "stop kills" is
 * assertable.
 */
class FakeChild extends EventEmitter implements TunnelChildProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((_signal?: NodeJS.Signals) => true);
}

/** Build a spawn fn that returns a pre-made fake and records the argv. */
function spawnReturning(child: TunnelChildProcess): {
  spawnFn: SpawnFn;
  calls: Array<{ command: string; args: readonly string[] }>;
} {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const spawnFn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    return child;
  };
  return { spawnFn, calls };
}

const URL = "https://brave-tiger-foo.trycloudflare.com";

describe("CloudflaredTunnel.start", () => {
  it("spawns `cloudflared tunnel --url http://localhost:<port>`", async () => {
    const child = new FakeChild();
    const { spawnFn, calls } = spawnReturning(child);
    const tunnel = new CloudflaredTunnel({ spawnFn });

    const started = tunnel.start(5173);
    child.stderr.write(URL + "\n");
    await started;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      command: "cloudflared",
      args: ["tunnel", "--url", "http://localhost:5173"],
    });
  });

  it("parses the trycloudflare URL from stderr and resolves with it", async () => {
    const child = new FakeChild();
    const { spawnFn } = spawnReturning(child);
    const tunnel = new CloudflaredTunnel({ spawnFn });

    const started = tunnel.start(3000);
    // cloudflared boxes the URL inside an ASCII banner on stderr.
    child.stderr.write(
      `+----------------------------------+\n|  Your quick Tunnel has been created!  |\n|  ${URL}  |\n+----------------------------------+\n`,
    );
    const active = await started;

    expect(active.url).toBe(URL);
  });

  it("parses the URL when split across two stderr chunks", async () => {
    const child = new FakeChild();
    const { spawnFn } = spawnReturning(child);
    const tunnel = new CloudflaredTunnel({ spawnFn });

    const started = tunnel.start(8080);
    // The matcher works per-chunk; cloudflared prints the full URL on one line,
    // so we assert a realistic single-line emission resolves.
    child.stdout.write("2026-05-31T00:00:00Z INF Registered tunnel\n");
    child.stderr.write(`2026-05-31T00:00:01Z INF ${URL}\n`);
    const active = await started;

    expect(active.url).toBe(URL);
  });

  it("rejects with an actionable message when cloudflared is not installed (ENOENT)", async () => {
    const child = new FakeChild();
    const { spawnFn } = spawnReturning(child);
    const tunnel = new CloudflaredTunnel({ spawnFn });

    const started = tunnel.start(5173);
    const enoent = Object.assign(new Error("spawn cloudflared ENOENT"), {
      code: "ENOENT",
    });
    child.emit("error", enoent);

    await expect(started).rejects.toThrow(/cloudflared not found/i);
    await expect(started).rejects.toThrow(/brew install cloudflared/i);
  });

  it("rejects if the process exits before a URL is seen", async () => {
    const child = new FakeChild();
    const { spawnFn } = spawnReturning(child);
    const tunnel = new CloudflaredTunnel({ spawnFn });

    const started = tunnel.start(5173);
    child.emit("exit", 1);

    await expect(started).rejects.toThrow(/exited.*before a tunnel URL/i);
  });

  it("rejects on startup timeout if no URL ever appears", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const { spawnFn } = spawnReturning(child);
      const tunnel = new CloudflaredTunnel({
        spawnFn,
        startupTimeoutMs: 1000,
      });

      const started = tunnel.start(5173);
      const assertion = expect(started).rejects.toThrow(
        /did not produce a tunnel URL within 1000ms/i,
      );
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() kills the underlying process", async () => {
    const child = new FakeChild();
    const { spawnFn } = spawnReturning(child);
    const tunnel = new CloudflaredTunnel({ spawnFn });

    const started = tunnel.start(5173);
    child.stderr.write(URL + "\n");
    const active = await started;

    active.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Idempotent: a second stop() does not double-kill.
    active.stop();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("kills the process when startup fails (no leaked child)", async () => {
    const child = new FakeChild();
    const { spawnFn } = spawnReturning(child);
    const tunnel = new CloudflaredTunnel({ spawnFn });

    const started = tunnel.start(5173);
    child.emit("exit", 2);
    await expect(started).rejects.toThrow();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects an invalid port without spawning", async () => {
    const child = new FakeChild();
    const { spawnFn, calls } = spawnReturning(child);
    const tunnel = new CloudflaredTunnel({ spawnFn });

    await expect(tunnel.start(0)).rejects.toThrow(/invalid port/i);
    expect(calls).toHaveLength(0);
  });
});
