import { describe, it, expect } from 'vitest';
import { captureSnapshot } from './capture.js';
import type { SnapshotPayload, SnapshotDegradation } from '@supercomment/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DOM/window doubles. jsdom is broken in this sandbox, so we hand-build the
 * minimal surfaces capture.ts touches: a document (nodeType/tagName/childNodes/
 * styleSheets/title/documentElement) and a window (history/location/listeners).
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function elementNode(tag: string, children: any[] = [], attrs: Record<string, string> = {}): any {
  return {
    nodeType: ELEMENT_NODE,
    tagName: tag.toUpperCase(),
    attributes: {
      length: Object.keys(attrs).length,
      item(i: number) {
        const entries = Object.entries(attrs);
        const entry = entries[i];
        return entry ? { name: entry[0], value: entry[1] } : null;
      },
    },
    childNodes: children,
  };
}

function textNode(t: string): any {
  return { nodeType: TEXT_NODE, nodeValue: t };
}

function fakeDoc(documentElement: any, title = 'Doc'): any {
  return {
    nodeType: 9,
    title,
    documentElement,
    styleSheets: [],
  };
}

const baseOpts = {
  url: 'https://app.example.com/page',
  baseUrl: 'https://app.example.com/page',
  origin: 'https://app.example.com',
  now: () => new Date('2026-05-30T00:00:00.000Z'),
};

describe('captureSnapshot', () => {
  it('produces a valid SnapshotPayload from a small document', () => {
    const doc = fakeDoc(
      elementNode('html', [elementNode('body', [textNode('hi')])]),
      'My Page',
    );
    const payload = captureSnapshot(doc, baseOpts);
    expect(payload.version).toBe(1);
    expect(payload.title).toBe('My Page');
    expect(payload.root.tag).toBe('html');
    expect(payload.truncated).toBe(false);
    expect(payload.capturedAt).toBe('2026-05-30T00:00:00.000Z');
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it('stores capture-time React context that is passed in', () => {
    const doc = fakeDoc(elementNode('html'));
    const payload = captureSnapshot(doc, {
      ...baseOpts,
      reactContext: { componentPath: ['App', 'Page'] },
    });
    expect(payload.reactContext?.componentPath).toEqual(['App', 'Page']);
  });

  it('truncates an oversized page with a flag, without throwing', () => {
    // Build a deep/wide tree that blows past a tiny cap.
    const many = Array.from({ length: 5000 }, (_, i) =>
      elementNode('div', [textNode('x'.repeat(50) + i)], { 'data-i': String(i) }),
    );
    const doc = fakeDoc(elementNode('html', [elementNode('body', many)]));
    let payload!: SnapshotPayload;
    expect(() => {
      payload = captureSnapshot(doc, { ...baseOpts, maxBytes: 5000 });
    }).not.toThrow();
    expect(payload.truncated).toBe(true);
    expect(
      payload.degraded.some((d: SnapshotDegradation) => d.kind === 'truncated'),
    ).toBe(true);
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it('does not truncate when under the cap', () => {
    const doc = fakeDoc(elementNode('html', [elementNode('body', [textNode('small')])]));
    const payload = captureSnapshot(doc, { ...baseOpts, maxBytes: 1_000_000 });
    expect(payload.truncated).toBe(false);
  });
});
