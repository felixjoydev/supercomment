import { describe, it, expect } from 'vitest';
import {
  generateLinkSecret,
  computeLinkPatch,
  isGuestLinkValid,
  isExpired,
  buildGuestUrl,
  LINK_SECRET_MIN_LENGTH,
  LinkActionError,
  type PreviewLinkState,
} from '../lib/link';
import { generateSlug, slugify } from '../lib/slug';

const baseState = (over: Partial<PreviewLinkState> = {}): PreviewLinkState => ({
  name: 'My preview',
  access_mode: 'team_only',
  link_secret: null,
  expires_at: null,
  ...over,
});

describe('link secret generation', () => {
  it('produces a secret of at least the minimum length', () => {
    const s = generateLinkSecret();
    expect(s.length).toBeGreaterThanOrEqual(LINK_SECRET_MIN_LENGTH);
    expect(s.length).toBeGreaterThanOrEqual(16);
  });

  it('is URL-safe (base64url alphabet only)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateLinkSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('is high-entropy: 1000 secrets are all unique', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateLinkSecret());
    expect(set.size).toBe(1000);
  });
});

describe('access-mode transitions', () => {
  it('enabling guest_link from team_only mints a secret', () => {
    const patch = computeLinkPatch(
      { type: 'set_access_mode', accessMode: 'guest_link' },
      baseState(),
    );
    expect(patch.access_mode).toBe('guest_link');
    expect(patch.link_secret).toBeDefined();
    expect(patch.link_secret!.length).toBeGreaterThanOrEqual(16);
  });

  it('enabling guest_link keeps an existing secret', () => {
    const patch = computeLinkPatch(
      { type: 'set_access_mode', accessMode: 'guest_link' },
      baseState({ access_mode: 'team_only', link_secret: 'existingsecret123456' }),
    );
    expect(patch.link_secret).toBe('existingsecret123456');
  });

  it('switching to team_only does not destroy the secret (use revoke for that)', () => {
    const patch = computeLinkPatch(
      { type: 'set_access_mode', accessMode: 'team_only' },
      baseState({ access_mode: 'guest_link', link_secret: 'keepme1234567890' }),
    );
    expect(patch.access_mode).toBe('team_only');
    expect('link_secret' in patch).toBe(false);
  });
});

describe('regenerate', () => {
  it('rotates to a different secret and the old one no longer matches', () => {
    const oldSecret = generateLinkSecret();
    const state = baseState({ access_mode: 'guest_link', link_secret: oldSecret });

    const patch = computeLinkPatch({ type: 'regenerate' }, state);
    expect(patch.link_secret).toBeDefined();
    expect(patch.link_secret).not.toBe(oldSecret);
    expect(patch.access_mode).toBe('guest_link');

    // After applying the patch, the OLD secret is invalid against the new state.
    const newState = baseState({
      access_mode: 'guest_link',
      link_secret: patch.link_secret!,
    });
    expect(newState.link_secret).not.toBe(oldSecret);
    expect(isGuestLinkValid(newState)).toBe(true);
  });
});

describe('revoke', () => {
  it('clears the secret and drops to team_only, invalidating the guest link', () => {
    const state = baseState({ access_mode: 'guest_link', link_secret: 'livesecret1234567' });
    expect(isGuestLinkValid(state)).toBe(true);

    const patch = computeLinkPatch({ type: 'revoke' }, state);
    expect(patch.link_secret).toBeNull();
    expect(patch.access_mode).toBe('team_only');

    const revoked = baseState({ access_mode: 'team_only', link_secret: null });
    expect(isGuestLinkValid(revoked)).toBe(false);
  });
});

describe('rename', () => {
  it('trims and sets the name', () => {
    const patch = computeLinkPatch({ type: 'rename', name: '  New name  ' }, baseState());
    expect(patch.name).toBe('New name');
  });
  it('rejects an empty name', () => {
    expect(() => computeLinkPatch({ type: 'rename', name: '   ' }, baseState())).toThrow(
      LinkActionError,
    );
  });
});

describe('expiry', () => {
  it('a preview past expires_at is treated as expired', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isExpired(past)).toBe(true);
  });

  it('a preview before expires_at is valid', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isExpired(future)).toBe(false);
  });

  it('no expiry means never expired', () => {
    expect(isExpired(null)).toBe(false);
  });

  it('an expired guest link is not valid even with a secret + guest_link mode', () => {
    const expired = baseState({
      access_mode: 'guest_link',
      link_secret: 'somesecret1234567',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(isGuestLinkValid(expired)).toBe(false);
  });

  it('set_expiry accepts null (clear) and rejects garbage', () => {
    expect(computeLinkPatch({ type: 'set_expiry', expiresAt: null }, baseState())).toEqual({
      expires_at: null,
    });
    expect(() =>
      computeLinkPatch({ type: 'set_expiry', expiresAt: 'not-a-date' }, baseState()),
    ).toThrow(LinkActionError);
  });
});

describe('buildGuestUrl', () => {
  it('returns a URL only when the link is valid', () => {
    const valid = baseState({ access_mode: 'guest_link', link_secret: 'abc1234567890def' });
    const url = buildGuestUrl('https://app.example.com/', 'cool-slug', valid);
    expect(url).toBe('https://app.example.com/s/cool-slug?k=abc1234567890def');
  });
  it('returns null for a revoked/team-only preview', () => {
    expect(buildGuestUrl('https://x.com', 'slug', baseState())).toBeNull();
  });
});

describe('slug generation', () => {
  it('generates a URL-safe slug of the requested length', () => {
    const s = generateSlug();
    expect(s).toMatch(/^[a-z0-9]+$/);
    expect(s.length).toBe(12);
  });
  it('slugify normalizes a name', () => {
    expect(slugify('My Cool Preview!!')).toBe('my-cool-preview');
  });
});
