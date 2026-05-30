import { describe, it, expect, vi } from 'vitest';
import { captureSnapshot, startSnapshotCapture } from './capture.js';
import type { SpaWindow } from './capture.js';
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

describe('startSnapshotCapture SPA trigger', () => {
  function makeWindow(): { win: SpaWindow; listeners: Record<string, Array<() => void>> } {
    const listeners: Record<string, Array<() => void>> = {};
    const doc = fakeDoc(elementNode('html', [elementNode('body', [textNode('hi')])]));
    const win: SpaWindow = {
      history: {
        pushState: () => {},
        replaceState: () => {},
      },
      addEventListener: (type, listener) => {
        (listeners[type] ??= []).push(listener);
      },
      removeEventListener: (type, listener) => {
        listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
      },
      location: {
        href: 'https://app.example.com/a',
        origin: 'https://app.example.com',
        pathname: '/a',
        search: '',
      },
      document: doc,
    };
    return { win, listeners };
  }

  it('captures once immediately on start', () => {
    const { win } = makeWindow();
    const sink = vi.fn();
    const handle = startSnapshotCapture({ sink, win });
    expect(sink).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('captures on pushState', () => {
    const { win } = makeWindow();
    const sink = vi.fn();
    const handle = startSnapshotCapture({ sink, win });
    sink.mockClear();
    win.history.pushState({}, '', '/b');
    expect(sink).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('captures on replaceState', () => {
    const { win } = makeWindow();
    const sink = vi.fn();
    const handle = startSnapshotCapture({ sink, win });
    sink.mockClear();
    win.history.replaceState({}, '', '/c');
    expect(sink).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('captures on popstate', () => {
    const { win, listeners } = makeWindow();
    const sink = vi.fn();
    const handle = startSnapshotCapture({ sink, win });
    sink.mockClear();
    listeners['popstate']?.forEach((l) => l());
    expect(sink).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('passes the current path to the sink', () => {
    const { win } = makeWindow();
    const sink = vi.fn();
    const handle = startSnapshotCapture({ sink, win });
    expect(sink).toHaveBeenCalledWith(expect.any(Object), '/a');
    handle.stop();
  });

  it('restores patched History methods on stop', () => {
    const { win } = makeWindow();
    const originalPush = win.history.pushState;
    const handle = startSnapshotCapture({ sink: vi.fn(), win });
    expect(win.history.pushState).not.toBe(originalPush);
    handle.stop();
    expect(win.history.pushState).toBe(originalPush);
  });

  it('never throws if capture fails internally', () => {
    const { win } = makeWindow();
    // Sink throws; capture wrapper should swallow it.
    const sink = vi.fn(() => {
      throw new Error('upload failed');
    });
    expect(() => {
      const handle = startSnapshotCapture({ sink, win });
      handle.stop();
    }).not.toThrow();
  });
});

// VERIFY IN REAL ENV: full-fidelity capture of a real browser document
// (computed styles via document.styleSheets[].cssRules, <img> srcset rendering,
// web fonts) cannot be exercised here — jsdom is broken and there is no real
// DOM. Cross-origin stylesheet/font fidelity (CORS-blocked rules can't be
// inlined) is handled by flagging `degraded`, but the visual result of the
// degraded offline render must be confirmed in a real browser.
