import { describe, it, expect } from 'vitest';
import {
  serializeDocument,
  rewriteCssUrls,
  rewriteSrcset,
} from './serialize';
import { MASKED_VALUE, REDACTION_PLACEHOLDER } from './mask';
import type { SnapshotNode } from '@supercomment/shared';

/**
 * jsdom is broken in this sandbox, so we hand-build a minimal DOM double that
 * exposes only the surface the serializer touches: nodeType, tagName,
 * nodeValue, attributes (NamedNodeMap-like), childNodes, and a document with
 * styleSheets + documentElement + title.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

class FakeAttrMap {
  private items: { name: string; value: string }[];
  constructor(attrs: Record<string, string>) {
    this.items = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  }
  get length() {
    return this.items.length;
  }
  item(i: number) {
    return this.items[i] ?? null;
  }
}

interface ElInit {
  tag: string;
  attrs?: Record<string, string>;
  children?: FakeNode[];
}

type FakeNode = FakeElement | FakeText;

class FakeElement {
  nodeType = ELEMENT_NODE;
  tagName: string;
  attributes: FakeAttrMap;
  childNodes: FakeNode[];
  constructor(init: ElInit) {
    this.tagName = init.tag.toUpperCase();
    this.attributes = new FakeAttrMap(init.attrs ?? {});
    this.childNodes = init.children ?? [];
  }
}

class FakeText {
  nodeType = TEXT_NODE;
  nodeValue: string;
  constructor(text: string) {
    this.nodeValue = text;
  }
}

function el(init: ElInit): FakeElement {
  return new FakeElement(init);
}
function text(t: string): FakeText {
  return new FakeText(t);
}

interface SheetInit {
  href: string | null;
  rules?: string[];
  throwOnRules?: boolean;
}

function fakeDoc(documentElement: FakeElement, sheets: SheetInit[] = [], title = 'Test') {
  return {
    nodeType: 9,
    title,
    documentElement,
    styleSheets: sheets.map((s) => ({
      href: s.href,
      get cssRules() {
        if (s.throwOnRules) throw new Error('SecurityError: cross-origin');
        return s.rules ? s.rules.map((cssText) => ({ cssText })) : undefined;
      },
    })),
  };
}

const baseOpts = {
  baseUrl: 'https://app.example.com/dashboard',
  origin: 'https://app.example.com',
};

function findByTag(node: SnapshotNode, tag: string): SnapshotNode | null {
  if (node.tag === tag) return node;
  for (const c of node.children ?? []) {
    const f = findByTag(c, tag);
    if (f) return f;
  }
  return null;
}

describe('serializeDocument', () => {
  it('preserves element hierarchy and attributes', () => {
    const tree = el({
      tag: 'html',
      children: [
        el({
          tag: 'body',
          children: [
            el({ tag: 'div', attrs: { id: 'root', class: 'app' }, children: [text('hello')] }),
          ],
        }),
      ],
    });
    const { root } = serializeDocument(fakeDoc(tree), baseOpts);
    expect(root.tag).toBe('html');
    const div = findByTag(root, 'div');
    expect(div?.attributes?.id).toBe('root');
    expect(div?.attributes?.class).toBe('app');
    expect(div?.children?.[0]?.type).toBe('text');
    expect(div?.children?.[0]?.text).toBe('hello');
  });

  it('assigns unique node ids in document order', () => {
    const tree = el({
      tag: 'html',
      children: [el({ tag: 'body', children: [el({ tag: 'span' })] })],
    });
    const { root } = serializeDocument(fakeDoc(tree), baseOpts);
    const ids: number[] = [];
    const walk = (n: SnapshotNode) => {
      ids.push(n.nodeId);
      n.children?.forEach(walk);
    };
    walk(root);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rewrites relative href/src to absolute', () => {
    const tree = el({
      tag: 'html',
      children: [
        el({
          tag: 'body',
          children: [
            el({ tag: 'a', attrs: { href: '/settings' } }),
            el({ tag: 'img', attrs: { src: 'logo.png' } }),
          ],
        }),
      ],
    });
    const { root } = serializeDocument(fakeDoc(tree), baseOpts);
    expect(findByTag(root, 'a')?.attributes?.href).toBe('https://app.example.com/settings');
    expect(findByTag(root, 'img')?.attributes?.src).toBe('https://app.example.com/logo.png');
  });

  it('rewrites srcset candidates to absolute', () => {
    const tree = el({
      tag: 'html',
      children: [el({ tag: 'img', attrs: { srcset: 'a.png 1x, b.png 2x' } })],
    });
    const { root } = serializeDocument(fakeDoc(tree), baseOpts);
    const srcset = findByTag(root, 'img')?.attributes?.srcset ?? '';
    expect(srcset).toContain('https://app.example.com/a.png 1x');
    expect(srcset).toContain('https://app.example.com/b.png 2x');
  });

  it('drops script elements and inline event handlers', () => {
    const tree = el({
      tag: 'html',
      children: [
        el({
          tag: 'body',
          children: [
            el({ tag: 'script', children: [text('alert(1)')] }),
            el({ tag: 'button', attrs: { onclick: 'doEvil()', id: 'b' } }),
          ],
        }),
      ],
    });
    const { root } = serializeDocument(fakeDoc(tree), baseOpts);
    expect(findByTag(root, 'script')).toBeNull();
    const btn = findByTag(root, 'button');
    expect(btn?.attributes?.onclick).toBeUndefined();
    expect(btn?.attributes?.id).toBe('b');
  });

  it('inlines same-origin stylesheets with absolute url() refs', () => {
    const tree = el({ tag: 'html' });
    const { stylesheets } = serializeDocument(
      fakeDoc(tree, [
        { href: 'https://app.example.com/main.css', rules: ['.x{background:url(bg.png)}'] },
      ]),
      baseOpts,
    );
    expect(stylesheets).toHaveLength(1);
    expect(stylesheets[0].css).toContain('url(https://app.example.com/bg.png)');
  });

  it('flags a cross-origin stylesheet as degraded without throwing', () => {
    const tree = el({ tag: 'html' });
    let result!: ReturnType<typeof serializeDocument>;
    expect(() => {
      result = serializeDocument(
        fakeDoc(tree, [{ href: 'https://cdn.other.com/x.css', throwOnRules: true }]),
        baseOpts,
      );
    }).not.toThrow();
    expect(result.degraded).toHaveLength(1);
    expect(result.degraded[0].kind).toBe('cross-origin-stylesheet');
    expect(result.stylesheets).toHaveLength(0);
  });

  it('produces a JSON-serializable result', () => {
    const tree = el({
      tag: 'html',
      children: [el({ tag: 'body', children: [text('content')] })],
    });
    const result = serializeDocument(fakeDoc(tree), baseOpts);
    expect(() => JSON.stringify(result)).not.toThrow();
    const round = JSON.parse(JSON.stringify(result)) as { root: { tag: string } };
    expect(round.root.tag).toBe('html');
  });

  it('keeps id and data-testid so anchors recompute (U7 consistency)', () => {
    const tree = el({
      tag: 'html',
      children: [
        el({
          tag: 'body',
          children: [
            el({ tag: 'ul', children: [
              el({ tag: 'li' }),
              el({ tag: 'li', attrs: { 'data-testid': 'second', id: 'item-2' } }),
            ] }),
          ],
        }),
      ],
    });
    const { root } = serializeDocument(fakeDoc(tree), baseOpts);
    const ul = findByTag(root, 'ul')!;
    const children = ul.children ?? [];
    expect(children).toHaveLength(2);
    const first = children[0]!;
    const second = children[1]!;
    expect(second.attributes?.['data-testid']).toBe('second');
    expect(second.attributes?.id).toBe('item-2');
    // structural position preserved -> nth-of-type(2) recomputable
    expect(first.tag).toBe('li');
    expect(second.tag).toBe('li');
  });

  it('masks password input values and redacts secret-shaped text', () => {
    const tree = el({
      tag: 'html',
      children: [
        el({
          tag: 'body',
          children: [
            el({ tag: 'input', attrs: { type: 'password', value: 'hunter2' } }),
            el({ tag: 'code', children: [text('Bearer abc123DEF456ghi789jkl')] }),
          ],
        }),
      ],
    });
    const { root } = serializeDocument(fakeDoc(tree), baseOpts);
    expect(findByTag(root, 'input')?.attributes?.value).toBe(MASKED_VALUE);
    const codeText = findByTag(root, 'code')?.children?.[0]?.text ?? '';
    expect(codeText).toContain(REDACTION_PLACEHOLDER);
    expect(codeText).not.toContain('abc123DEF456ghi789jkl');
  });
});

describe('rewriteCssUrls', () => {
  const r = (u: string, b: string) => new URL(u, b).toString();
  it('rewrites relative url() to absolute', () => {
    const out = rewriteCssUrls('.a{background:url("img/x.png")}', 'https://h.test/a/b', r);
    expect(out).toContain('https://h.test/a/img/x.png');
  });
  it('leaves data: urls alone', () => {
    const css = '.a{background:url(data:image/png;base64,AAAA)}';
    expect(rewriteCssUrls(css, 'https://h.test/', r)).toBe(css);
  });
});

describe('rewriteSrcset', () => {
  const r = (u: string, b: string) => new URL(u, b).toString();
  it('rewrites each candidate', () => {
    const out = rewriteSrcset('a.png 1x, sub/b.png 2x', 'https://h.test/p/', r);
    expect(out).toBe('https://h.test/p/a.png 1x, https://h.test/p/sub/b.png 2x');
  });
});
