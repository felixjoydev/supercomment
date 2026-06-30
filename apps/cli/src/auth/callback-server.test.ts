import { describe, expect, it } from "vitest";

import {
  CALLBACK_PATH,
  handleCallbackRequest,
  startCallbackServer,
  type ReceivedCreds,
} from "./callback-server.js";

const STATE = "test-nonce-abc123";
const ORIGIN = "http://localhost:3000";
const GOOD = {
  state: STATE,
  token: "member-jwt",
  refreshToken: "refresh-abc",
  supabaseUrl: "https://ref.supabase.co",
  anonKey: "anon-key",
  email: "dev@example.com",
};

describe("handleCallbackRequest (pure)", () => {
  it("answers the CORS preflight with the opened origin", () => {
    const out = handleCallbackRequest(
      { method: "OPTIONS", path: CALLBACK_PATH, body: "" },
      { state: STATE, allowOrigin: ORIGIN },
    );
    expect(out.status).toBe(204);
    expect(out.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(out.headers["access-control-allow-methods"]).toContain("POST");
    expect(out.creds).toBeUndefined();
  });

  it("accepts a valid POST and returns creds", () => {
    const out = handleCallbackRequest(
      { method: "POST", path: CALLBACK_PATH, body: JSON.stringify(GOOD) },
      { state: STATE, allowOrigin: ORIGIN },
    );
    expect(out.status).toBe(200);
    expect(out.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(out.creds).toEqual({
      token: "member-jwt",
      refreshToken: "refresh-abc",
      supabaseUrl: "https://ref.supabase.co",
      anonKey: "anon-key",
      email: "dev@example.com",
    } satisfies ReceivedCreds);
  });

  it("rejects a state mismatch with 403 and NO creds (CSRF guard)", () => {
    const out = handleCallbackRequest(
      {
        method: "POST",
        path: CALLBACK_PATH,
        body: JSON.stringify({ ...GOOD, state: "wrong" }),
      },
      { state: STATE, allowOrigin: ORIGIN },
    );
    expect(out.status).toBe(403);
    expect(out.creds).toBeUndefined();
  });

  it("rejects a missing token with 400 and no creds", () => {
    const { token: _drop, ...noToken } = GOOD;
    const out = handleCallbackRequest(
      { method: "POST", path: CALLBACK_PATH, body: JSON.stringify(noToken) },
      { state: STATE, allowOrigin: ORIGIN },
    );
    expect(out.status).toBe(400);
    expect(out.creds).toBeUndefined();
  });

  it("rejects invalid JSON with 400", () => {
    const out = handleCallbackRequest(
      { method: "POST", path: CALLBACK_PATH, body: "{not json" },
      { state: STATE, allowOrigin: ORIGIN },
    );
    expect(out.status).toBe(400);
    expect(out.creds).toBeUndefined();
  });

  it("404s any non-callback path and 405s a non-POST method", () => {
    expect(
      handleCallbackRequest(
        { method: "GET", path: "/", body: "" },
        { state: STATE, allowOrigin: ORIGIN },
      ).status,
    ).toBe(404);
    expect(
      handleCallbackRequest(
        { method: "GET", path: CALLBACK_PATH, body: "" },
        { state: STATE, allowOrigin: ORIGIN },
      ).status,
    ).toBe(405);
  });

  it("omits email when absent", () => {
    const { email: _drop, ...noEmail } = GOOD;
    const out = handleCallbackRequest(
      { method: "POST", path: CALLBACK_PATH, body: JSON.stringify(noEmail) },
      { state: STATE, allowOrigin: ORIGIN },
    );
    expect(out.creds).toBeDefined();
    expect(out.creds).not.toHaveProperty("email");
  });
});

describe("startCallbackServer (real loopback socket)", () => {
  it("binds loopback, resolves creds on a valid POST, then closes", async () => {
    const server = await startCallbackServer({ state: STATE, allowOrigin: ORIGIN });
    expect(typeof server.port).toBe("number");
    expect(server.port).toBeGreaterThan(0);

    const waiting = server.waitForCreds(2000);
    const res = await fetch(`http://127.0.0.1:${server.port}${CALLBACK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(GOOD),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);

    const creds = await waiting;
    expect(creds.token).toBe("member-jwt");
    expect(creds.anonKey).toBe("anon-key");
  });

  it("times out when no authorization arrives", async () => {
    const server = await startCallbackServer({ state: STATE, allowOrigin: ORIGIN });
    await expect(server.waitForCreds(50)).rejects.toThrow(/timed out/i);
  });

  it("does not resolve on a state mismatch", async () => {
    const server = await startCallbackServer({ state: STATE, allowOrigin: ORIGIN });
    const waiting = server.waitForCreds(150);
    const res = await fetch(`http://127.0.0.1:${server.port}${CALLBACK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...GOOD, state: "attacker" }),
    });
    expect(res.status).toBe(403);
    // The bad POST must NOT satisfy the wait — it should time out instead.
    await expect(waiting).rejects.toThrow(/timed out/i);
  });
});
