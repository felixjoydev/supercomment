import { describe, it, expect, vi } from 'vitest';

import {
  CAPTURES_BUCKET,
  classifyCaptureRef,
  resolveCaptureSrc,
  type CaptureSigner,
} from '../lib/comments/capture-ref';

describe('classifyCaptureRef', () => {
  it('classifies an inline image data URL as directly renderable', () => {
    expect(classifyCaptureRef('data:image/png;base64,AAAA')).toBe('image-url');
  });

  it('classifies the DOM-snapshot fallback as a snapshot indicator', () => {
    expect(classifyCaptureRef('data:application/json,%7B%7D')).toBe('snapshot');
  });

  it('classifies an http(s) URL as directly renderable', () => {
    expect(
      classifyCaptureRef('https://x.supabase.co/storage/v1/object/sign/captures/a.png'),
    ).toBe('image-url');
  });

  it('classifies a bare bucket object path as a ref needing signing', () => {
    expect(
      classifyCaptureRef('3fb218bf-0000-4000-8000-000000000000/cap-1.png'),
    ).toBe('image-ref');
  });

  it('classifies missing/empty as none', () => {
    expect(classifyCaptureRef(undefined)).toBe('none');
    expect(classifyCaptureRef('')).toBe('none');
  });
});

describe('resolveCaptureSrc', () => {
  it('signs a private-bucket ref via the captures bucket', async () => {
    const signer = vi.fn<CaptureSigner>(
      async (_bucket, path) => `https://signed/${path}?token=abc`,
    );
    const ref = '3fb218bf-0000-4000-8000-000000000000/cap-1.png';

    const url = await resolveCaptureSrc(ref, signer);

    expect(signer).toHaveBeenCalledWith(CAPTURES_BUCKET, ref);
    expect(url).toBe(`https://signed/${ref}?token=abc`);
  });

  it('returns an inline image URL unchanged without signing', async () => {
    const signer = vi.fn<CaptureSigner>(async () => 'should-not-be-used');
    const url = await resolveCaptureSrc('data:image/png;base64,AAAA', signer);
    expect(url).toBe('data:image/png;base64,AAAA');
    expect(signer).not.toHaveBeenCalled();
  });

  it('returns null for the snapshot fallback (not a resolvable image)', async () => {
    const signer = vi.fn<CaptureSigner>(async () => 'should-not-be-used');
    expect(await resolveCaptureSrc('data:application/json,%7B%7D', signer)).toBeNull();
    expect(signer).not.toHaveBeenCalled();
  });

  it('returns null when signing fails (missing object / no permission)', async () => {
    const signer: CaptureSigner = async () => null;
    expect(await resolveCaptureSrc('preview/cap.png', signer)).toBeNull();
  });

  it('never throws when the signer rejects', async () => {
    const signer: CaptureSigner = async () => {
      throw new Error('boom');
    };
    await expect(resolveCaptureSrc('preview/cap.png', signer)).resolves.toBeNull();
  });
});
