import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import {
  buildBootScript,
  runStart,
  type OverlayBootConfig,
  type RegisterTunnel,
  type RunStartOptions,
} from "./index.js";
import type { ChannelSupabaseClient } from "../channel/index.js";
import type { ActiveTunnel, TunnelProvider } from "../tunnel/cloudflared.js";
import type { ProjectBinding } from "../config/binding.js";

const BINDING: ProjectBinding = {
  supabaseUrl: "https://example.supabase.co",
  token: "dev-token",
  previewId: "11111111-1111-1111-1111-111111111111",
  projectId: "22222222-2222-2222-2222-222222222222",
};

/**
 * A fake http.Server good enough for runStart: records 'upgrade' wiring, fakes
 * `listen` (calls back + reports a port via address()), and `close`. The request
 * handler is captured so a test can drive it.
 */
class FakeServer extends EventEmitter {
  listening = false;
  closed = false;
  constructor(
    public handler: (req: IncomingMessage, res: ServerResponse) => void,
  ) {
    super();
  }
  listen(_port: number, _host: string, cb?: () => void): this {
    this.listening = true;
    cb?.();
    return this;
  }
  address(): { port: number } {
    return { port: 45678 };
  }
  close(cb?: () => void): this {
    this.closed = true;
    cb?.();
    return this;
  }
}

/** A tunnel provider whose start() resolves with a recorded port. */
function fakeTunnel(events: string[]): {
  provider: TunnelProvider;
  active: ActiveTunnel & { stopped: boolean };
} {
  const active = {
    url: "https://fake-tunnel.trycloudflare.com",
    stopped: false,
    stop() {
      this.stopped = true;
      events.push("tunnel.stop");
    },
  };
  const provider: TunnelProvider = {
    async start(port: number): Promise<ActiveTunnel> {
      events.push(`tunnel.start:${port}`);
      return active;
    },
  };
  return { provider, active };
}

/** A Supabase client fake: rpc records calls; channel() is absent (polling). */
function fakeClient(events: string[]): ChannelSupabaseClient {
  return {
    async rpc(fn: string) {
      events.push(`rpc:${fn}`);
      return { data: null, error: null };
    },
  };
}

type TestOptions = RunStartOptions & { __logs: string[] };

function baseOptions(
  events: string[],
  overrides: Partial<RunStartOptions> = {},
): TestOptions {
  const { provider } = fakeTunnel(events);
  const register: RegisterTunnel = async ({ tunnelUrl }) => {
    events.push(`register:${tunnelUrl}`);
    return { shareUrl: "https://app.supercomment.dev/s/cool-slug" };
  };
  const logs: string[] = [];
  const opts: RunStartOptions = {
    port: 5173,
    binding: BINDING,
    client: fakeClient(events),
    tunnelProvider: provider,
    registerTunnel: register,
    readOverlayBundle: async () => "/*overlay iife*/",
    signals: new EventEmitter() as NodeJS.EventEmitter,
    heartbeatIntervalMs: 100_000,
    createServer: (h) =>
      new FakeServer(h) as unknown as import("node:http").Server,
    logger: {
      log: (l) => logs.push(l),
      warn: (l) => logs.push(`WARN ${l}`),
    },
    ...overrides,
  };
  return Object.assign(opts, { __logs: logs });
}

describe("buildBootScript", () => {
  it("assigns window.__SUPERCOMMENT__ with the boot config", () => {
    const config: OverlayBootConfig = {
      previewId: "p-1",
      linkSecret: "secret-xyz",
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "anon-key",
    };
    const script = buildBootScript(config);
    expect(script).toContain("window.__SUPERCOMMENT__");
    expect(script).toContain("secret-xyz");
    expect(script).toContain("anon-key");
    // It must be a single assignment statement (no template injection holes).
    expect(script).toContain(JSON.stringify(config));
  });
});

describe("runStart orchestration", () => {
  function optsWith(env: Record<string, string>) {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
  }
  function clearEnv(keys: string[]) {
    for (const k of keys) delete process.env[k];
  }

  it("wires front-server -> tunnel -> register -> channel in order", async () => {
    optsWith({
      SUPERCOMMENT_LINK_SECRET: "link-secret",
      SUPERCOMMENT_ANON_KEY: "anon-key",
    });
    try {
      const events: string[] = [];
      const opts = baseOptions(events);
      const handle = await runStart(opts);

      expect(handle.tunnelUrl).toBe("https://fake-tunnel.trycloudflare.com");
      expect(handle.shareUrl).toBe(
        "https://app.supercomment.dev/s/cool-slug",
      );

      // Tunnel starts AFTER the front server (port 45678 from the fake).
      // Register happens AFTER the tunnel URL exists.
      // Channel heartbeat (rpc:preview_heartbeat) happens AFTER register.
      const tunnelIdx = events.findIndex((e) => e.startsWith("tunnel.start"));
      const registerIdx = events.findIndex((e) => e.startsWith("register:"));
      const heartbeatIdx = events.findIndex(
        (e) => e === "rpc:preview_heartbeat",
      );

      expect(tunnelIdx).toBeGreaterThanOrEqual(0);
      expect(registerIdx).toBeGreaterThan(tunnelIdx);
      expect(heartbeatIdx).toBeGreaterThan(registerIdx);

      // The tunnel pointed at the FRONT server port, not the dev port.
      expect(events).toContain("tunnel.start:45678");

      await handle.shutdown();
    } finally {
      clearEnv(["SUPERCOMMENT_LINK_SECRET", "SUPERCOMMENT_ANON_KEY"]);
    }
  });

  it("prints the shareable link and the no-install message", async () => {
    optsWith({
      SUPERCOMMENT_LINK_SECRET: "link-secret",
      SUPERCOMMENT_ANON_KEY: "anon-key",
    });
    try {
      const events: string[] = [];
      const opts = baseOptions(events);
      const handle = await runStart(opts);
      const printed = opts.__logs.join("\n");
      expect(printed).toContain("https://app.supercomment.dev/s/cool-slug");
      expect(printed).toContain("nothing to install");
      // Exposure warning is printed too.
      expect(printed).toContain("about to share your running app");
      await handle.shutdown();
    } finally {
      clearEnv(["SUPERCOMMENT_LINK_SECRET", "SUPERCOMMENT_ANON_KEY"]);
    }
  });

  it("serves the overlay bundle and boot script from the front server", async () => {
    optsWith({
      SUPERCOMMENT_LINK_SECRET: "link-secret",
      SUPERCOMMENT_ANON_KEY: "anon-key",
    });
    try {
      const events: string[] = [];
      let captured: FakeServer | undefined;
      const opts = baseOptions(events, {
        createServer: (h) => {
          captured = new FakeServer(h);
          return captured as unknown as import("node:http").Server;
        },
      });
      const handle = await runStart(opts);
      expect(captured).toBeDefined();

      const bundleRes = fakeRes();
      captured!.handler(
        { url: "/__supercomment/overlay.js" } as IncomingMessage,
        bundleRes.res,
      );
      expect(bundleRes.body).toContain("overlay iife");

      const bootRes = fakeRes();
      captured!.handler(
        { url: "/__supercomment/boot.js" } as IncomingMessage,
        bootRes.res,
      );
      expect(bootRes.body).toContain("window.__SUPERCOMMENT__");
      expect(bootRes.body).toContain("link-secret");

      await handle.shutdown();
    } finally {
      clearEnv(["SUPERCOMMENT_LINK_SECRET", "SUPERCOMMENT_ANON_KEY"]);
    }
  });

  it("SIGINT triggers a clean shutdown (tunnel stop, offline, server close)", async () => {
    optsWith({
      SUPERCOMMENT_LINK_SECRET: "link-secret",
      SUPERCOMMENT_ANON_KEY: "anon-key",
    });
    try {
      const events: string[] = [];
      const signals = new EventEmitter();
      let captured: FakeServer | undefined;
      const opts = baseOptions(events, {
        signals: signals as NodeJS.EventEmitter,
        createServer: (h) => {
          captured = new FakeServer(h);
          return captured as unknown as import("node:http").Server;
        },
      });
      await runStart(opts);

      // Fire SIGINT; let the async shutdown settle.
      signals.emit("SIGINT");
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      expect(events).toContain("tunnel.stop");
      // Channel.stop pushes offline via the RPC.
      expect(events).toContain("rpc:preview_offline");
      expect(captured!.closed).toBe(true);
    } finally {
      clearEnv(["SUPERCOMMENT_LINK_SECRET", "SUPERCOMMENT_ANON_KEY"]);
    }
  });

  it("cleans up if registration fails (no live preview leaked)", async () => {
    optsWith({
      SUPERCOMMENT_LINK_SECRET: "link-secret",
      SUPERCOMMENT_ANON_KEY: "anon-key",
    });
    try {
      const events: string[] = [];
      const failingRegister: RegisterTunnel = async () => {
        events.push("register:boom");
        throw new Error("backend rejected");
      };
      const opts = baseOptions(events, { registerTunnel: failingRegister });

      await expect(runStart(opts)).rejects.toThrow(/backend rejected/);
      // The tunnel we started must be stopped during failure cleanup.
      expect(events).toContain("tunnel.stop");
      // We never reached the heartbeat (preview never marked live).
      expect(events).not.toContain("rpc:preview_heartbeat");
    } finally {
      clearEnv(["SUPERCOMMENT_LINK_SECRET", "SUPERCOMMENT_ANON_KEY"]);
    }
  });

  it("rejects an invalid port", async () => {
    const events: string[] = [];
    const opts = baseOptions(events, { port: 0 });
    await expect(runStart(opts)).rejects.toThrow(/valid TCP port/);
  });
});

/** A minimal ServerResponse fake that records writeHead + the body. */
function fakeRes(): {
  res: ServerResponse;
  body: string;
  status?: number;
} {
  const state = { body: "", status: undefined as number | undefined };
  const res = {
    writeHead(status: number) {
      state.status = status;
      return res;
    },
    end(chunk?: string) {
      if (chunk) state.body += chunk;
      return res;
    },
  } as unknown as ServerResponse;
  return {
    res,
    get body() {
      return state.body;
    },
    get status() {
      return state.status;
    },
  };
}
