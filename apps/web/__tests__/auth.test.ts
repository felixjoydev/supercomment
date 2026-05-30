import { describe, it, expect } from 'vitest';
import { requireMember, requireAuthedUser, type VerifiedClaims } from '../lib/auth-guard';
import { deriveStatus, HEARTBEAT_STALE_MS } from '../lib/status';

const member: VerifiedClaims = { sub: 'user-1', is_anonymous: false };
const anon: VerifiedClaims = { sub: 'anon-1', is_anonymous: true };

describe('requireMember (route-handler / action authz guard)', () => {
  it('rejects an unauthenticated caller with 401', () => {
    const r = requireMember(null, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('rejects a claims object with no subject with 401', () => {
    const r = requireMember({}, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('rejects an anonymous (guest) session with 403', () => {
    const r = requireMember(anon, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('rejects a signed-in NON-member of the team with 403', () => {
    const r = requireMember(member, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('allows a signed-in member of the team', () => {
    const r = requireMember(member, true);
    expect(r.ok).toBe(true);
  });
});

describe('requireAuthedUser', () => {
  it('rejects no claims (401)', () => {
    const r = requireAuthedUser(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });
  it('rejects anonymous users (403)', () => {
    const r = requireAuthedUser(anon);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
  it('allows a non-anonymous signed-in user', () => {
    expect(requireAuthedUser(member).ok).toBe(true);
  });
});

describe('status derivation (live/offline from heartbeat)', () => {
  const now = new Date('2026-05-30T12:00:00.000Z');

  it('a fresh heartbeat within the threshold → live', () => {
    const recent = new Date(now.getTime() - (HEARTBEAT_STALE_MS - 5_000)).toISOString();
    expect(deriveStatus({ dbStatus: 'live', lastHeartbeatAt: recent, now })).toBe('live');
  });

  it('a stale heartbeat older than the threshold → offline', () => {
    const stale = new Date(now.getTime() - (HEARTBEAT_STALE_MS + 5_000)).toISOString();
    expect(deriveStatus({ dbStatus: 'live', lastHeartbeatAt: stale, now })).toBe('offline');
  });

  it('no heartbeat at all → offline', () => {
    expect(deriveStatus({ dbStatus: 'live', lastHeartbeatAt: null, now })).toBe('offline');
  });

  it('a fresh heartbeat but dbStatus offline → offline (explicit shutdown)', () => {
    const recent = new Date(now.getTime() - 1_000).toISOString();
    expect(deriveStatus({ dbStatus: 'offline', lastHeartbeatAt: recent, now })).toBe('offline');
  });

  it('a malformed heartbeat timestamp → offline (fails safe)', () => {
    expect(deriveStatus({ dbStatus: 'live', lastHeartbeatAt: 'nonsense', now })).toBe('offline');
  });
});

// VERIFY IN REAL ENV: the full magic-link / OAuth round trip (email delivery,
// provider redirect, code exchange at /auth/callback, cookie set) and the
// proxy.ts session-refresh + redirect behavior require a live Supabase project
// and a running Next server, so they are not unit-tested here.
