import { describe, expect, it, vi } from "vitest";

import { Heartbeat, type HeartbeatTimer, type PreviewStatus } from "./heartbeat.js";

/** A manual timer: tests call `tick()` to fire the interval callback. */
function manualTimer(): HeartbeatTimer & { tick: () => void; cleared: boolean } {
  let cb: (() => void) | undefined;
  let cleared = false;
  return {
    setInterval: (fn) => {
      cb = fn;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
      cb = undefined;
    },
    tick: () => cb?.(),
    get cleared() {
      return cleared;
    },
  } as HeartbeatTimer & { tick: () => void; cleared: boolean };
}

/** Wait for queued microtasks (the heartbeat pushes via void async). */
const flush = () => new Promise<void>((r) => setImmediate(r));

describe("Heartbeat", () => {
  it("marks 'live' immediately on start and on every tick", async () => {
    const updates: PreviewStatus[] = [];
    const timer = manualTimer();
    const hb = new Heartbeat({
      update: async (s) => {
        updates.push(s);
      },
      timer,
    });

    hb.start();
    await flush();
    expect(updates).toEqual(["live"]); // immediate

    timer.tick();
    await flush();
    timer.tick();
    await flush();
    expect(updates).toEqual(["live", "live", "live"]);
    expect(hb.isRunning).toBe(true);
  });

  it("marks 'offline' EXACTLY ONCE on stop, even if stop is called repeatedly", async () => {
    const updates: PreviewStatus[] = [];
    const timer = manualTimer();
    const hb = new Heartbeat({
      update: async (s) => {
        updates.push(s);
      },
      timer,
    });

    hb.start();
    await flush();
    hb.stop();
    hb.stop();
    hb.stop();
    await flush();

    const offlineCount = updates.filter((s) => s === "offline").length;
    expect(offlineCount).toBe(1);
    expect(updates).toEqual(["live", "offline"]);
    expect(timer.cleared).toBe(true);
    expect(hb.isRunning).toBe(false);
  });

  it("ignores a tick that fires after stop (never resurrects to 'live')", async () => {
    const updates: PreviewStatus[] = [];
    const timer = manualTimer();
    const hb = new Heartbeat({
      update: async (s) => {
        updates.push(s);
      },
      timer,
    });

    hb.start();
    await flush();
    hb.stop();
    await flush();
    timer.tick(); // late tick — must be a no-op
    await flush();

    expect(updates).toEqual(["live", "offline"]);
  });

  it("start() is idempotent (single immediate 'live')", async () => {
    const updates: PreviewStatus[] = [];
    const timer = manualTimer();
    const hb = new Heartbeat({
      update: async (s) => {
        updates.push(s);
      },
      timer,
    });
    hb.start();
    hb.start();
    await flush();
    expect(updates).toEqual(["live"]);
  });

  it("refuses restart after stop", async () => {
    const hb = new Heartbeat({ update: async () => {}, timer: manualTimer() });
    hb.start();
    hb.stop();
    expect(() => hb.start()).toThrow(/cannot be restarted/i);
  });

  it("continues after an updater rejection and surfaces it via onError", async () => {
    const onError = vi.fn();
    const timer = manualTimer();
    let calls = 0;
    const hb = new Heartbeat({
      update: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network blip");
      },
      timer,
      onError,
    });

    hb.start(); // first push rejects
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("live", expect.any(Error));

    timer.tick(); // loop survives, second push succeeds
    await flush();
    expect(calls).toBe(2);
  });

  it("does not emit 'offline' if stopped before ever starting", async () => {
    const updates: PreviewStatus[] = [];
    const hb = new Heartbeat({
      update: async (s) => {
        updates.push(s);
      },
      timer: manualTimer(),
    });
    hb.stop();
    await flush();
    expect(updates).toEqual([]);
  });
});
