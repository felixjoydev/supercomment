import type {
  SnapshotNode,
  SnapshotStylesheet,
  SnapshotDegradation,
} from '@supercomment/shared';
import { maskFieldAttributes, redactSecrets } from './mask.js';

/**
 * Hand-rolled DOM serializer (U10).
 *
 * We deliberately do NOT pull in rrweb-snapshot: the sandbox network is
 * unreliable and the contract we need is narrow (an id'd node tree + inlined
 * same-origin CSS + absolute URLs + masking). The shape produced here is
 * rrweb-snapshot-STYLE (full-DOM, id'd, self-contained) but original code.
 *
 * Design goals:
 *  - Self-contained: same-origin stylesheets inlined, relative URLs rewritten
 *    absolute, so the page renders offline.
 *  - Anchorable: id / data-* attributes and child ordering preserved verbatim
 *    so U7's selector strategy recomputes against the snapshot.
 *  - Safe: masking applied to form values + secret-shaped text BEFORE the tree
 *    is emitted (we never serialize raw secrets).
 *  - Robust: never throws on cross-origin CSS — flagged as degraded instead.
 *
 * The serializer touches only a minimal DOM surface so it can be unit-tested
 * against a fake DOM (jsdom is broken in this sandbox).
 */

// Node type constants (avoid relying on a global Node in node env).
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

/** URL-bearing attributes we rewrite to absolute. */
const URL_ATTRS = new Set(['href', 'src', 'poster', 'data', 'cite', 'action', 'formaction']);

/** Attributes we drop entirely (event handlers, nonces, integrity churn). */
const DROP_ATTR = /^on/i;

export interface SerializeOptions {
  /** Absolute base URL used to resolve relative href/src/url(). */
  baseUrl: string;
  /** Document origin used to decide if a stylesheet is same-origin. */
  origin: string;
  /**
   * Resolver from a (possibly relative) URL + base to an absolute URL.
   * Injectable so tests don't need the WHATWG URL parser quirks of a browser.
   * Defaults to the standard URL constructor.
   */
  resolveUrl?: (url: string, base: string) => string;
}

export interface SerializeResult {
  root: SnapshotNode;
  stylesheets: SnapshotStylesheet[];
  degraded: SnapshotDegradation[];
}

function defaultResolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/** Rewrite `url(...)` references inside a CSS string to absolute. */
export function rewriteCssUrls(
  css: string,
  baseUrl: string,
  resolveUrl: (u: string, b: string) => string,
): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, quote: string, ref: string) => {
    const trimmed = ref.trim();
    // Leave data: and absolute-with-scheme refs alone.
    if (/^(data:|https?:|blob:|#)/i.test(trimmed)) {
      return `url(${quote}${trimmed}${quote})`;
    }
    return `url(${quote}${resolveUrl(trimmed, baseUrl)}${quote})`;
  });
}

/** Rewrite a srcset value (comma-separated candidate URLs) to absolute. */
export function rewriteSrcset(
  srcset: string,
  baseUrl: string,
  resolveUrl: (u: string, b: string) => string,
): string {
  return srcset
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      const url = parts[0];
      if (!url) return candidate.trim();
      parts[0] = resolveUrl(url, baseUrl);
      return parts.join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

interface MinimalNamedNodeMap {
  length: number;
  item(index: number): { name: string; value: string } | null;
}

interface MinimalNode {
  nodeType: number;
  nodeName?: string;
  tagName?: string;
  nodeValue?: string | null;
  textContent?: string | null;
  attributes?: MinimalNamedNodeMap | null;
  childNodes?: ArrayLike<MinimalNode>;
}

function readAttributes(el: MinimalNode): Record<string, string> {
  const out: Record<string, string> = {};
  const attrs = el.attributes;
  if (!attrs) return out;
  for (let i = 0; i < attrs.length; i += 1) {
    const a = attrs.item(i);
    if (!a) continue;
    if (DROP_ATTR.test(a.name)) continue; // strip inline event handlers
    out[a.name] = a.value ?? '';
  }
  return out;
}

function rewriteAttributeUrls(
  tag: string,
  attrs: Record<string, string>,
  opts: Required<Pick<SerializeOptions, 'baseUrl' | 'resolveUrl'>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    const lname = name.toLowerCase();
    if (lname === 'srcset') {
      out[name] = rewriteSrcset(value, opts.baseUrl, opts.resolveUrl);
    } else if (URL_ATTRS.has(lname)) {
      out[name] = opts.resolveUrl(value, opts.baseUrl);
    } else if (lname === 'style') {
      out[name] = rewriteCssUrls(value, opts.baseUrl, opts.resolveUrl);
    } else {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Serialize a single node into a SnapshotNode (or null to skip, e.g. script).
 * `idRef` is a mutable counter object so ids are unique & document-ordered.
 */
function serializeNode(
  node: MinimalNode,
  idRef: { next: number },
  opts: Required<Pick<SerializeOptions, 'baseUrl' | 'resolveUrl'>>,
): SnapshotNode | null {
  if (node.nodeType === TEXT_NODE) {
    const raw = node.nodeValue ?? node.textContent ?? '';
    return {
      nodeId: idRef.next++,
      type: 'text',
      text: redactSecrets(raw),
    };
  }

  if (node.nodeType === COMMENT_NODE) {
    return {
      nodeId: idRef.next++,
      type: 'comment',
      text: redactSecrets(node.nodeValue ?? ''),
    };
  }

  if (node.nodeType !== ELEMENT_NODE) {
    return null;
  }

  const tag = (node.tagName ?? node.nodeName ?? '').toLowerCase();
  if (!tag) return null;

  // Drop executable / non-renderable elements. <style>/<link> are captured via
  // the stylesheet pass, so we omit their raw form here to avoid double-apply.
  if (tag === 'script' || tag === 'noscript') {
    return null;
  }

  let attrs = readAttributes(node);
  attrs = rewriteAttributeUrls(tag, attrs, opts);
  attrs = maskFieldAttributes({ tag, attributes: attrs });
  // Redact secret-shaped values lingering in non-URL attributes.
  for (const key of Object.keys(attrs)) {
    const lk = key.toLowerCase();
    if (URL_ATTRS.has(lk) || lk === 'srcset' || lk === 'style') continue;
    const val = attrs[key];
    if (val !== undefined) attrs[key] = redactSecrets(val);
  }

  const result: SnapshotNode = {
    nodeId: idRef.next++,
    type: 'element',
    tag,
    attributes: attrs,
  };

  const kids = node.childNodes;
  if (kids && kids.length) {
    const children: SnapshotNode[] = [];
    for (let i = 0; i < kids.length; i += 1) {
      const kid = kids[i];
      if (!kid) continue;
      const child = serializeNode(kid, idRef, opts);
      if (child) children.push(child);
    }
    if (children.length) result.children = children;
  }

  return result;
}

interface MinimalStyleSheet {
  href: string | null;
  /** cssRules access throws (SecurityError) for cross-origin sheets. */
  cssRules?: ArrayLike<{ cssText: string }>;
  ownerNode?: { tagName?: string } | null;
}

interface MinimalDocument extends MinimalNode {
  styleSheets?: ArrayLike<MinimalStyleSheet>;
  documentElement?: MinimalNode;
  title?: string;
}

/**
 * Inline same-origin stylesheets. Cross-origin sheets (whose cssRules access
 * throws under CORS) are flagged degraded rather than throwing. url() refs
 * inside captured CSS are rewritten absolute.
 */
export function collectStylesheets(
  doc: MinimalDocument,
  opts: Required<Pick<SerializeOptions, 'baseUrl' | 'origin' | 'resolveUrl'>>,
): { stylesheets: SnapshotStylesheet[]; degraded: SnapshotDegradation[] } {
  const stylesheets: SnapshotStylesheet[] = [];
  const degraded: SnapshotDegradation[] = [];
  const sheets = doc.styleSheets;
  if (!sheets) return { stylesheets, degraded };

  for (let i = 0; i < sheets.length; i += 1) {
    const sheet = sheets[i];
    if (!sheet) continue;
    const absHref = sheet.href ? opts.resolveUrl(sheet.href, opts.baseUrl) : null;
    try {
      const rules = sheet.cssRules;
      if (!rules) {
        // No rules readable (often cross-origin without CORS headers).
        degraded.push({
          kind: 'cross-origin-stylesheet',
          detail: absHref ?? '(inline stylesheet with unreadable rules)',
        });
        continue;
      }
      let css = '';
      for (let r = 0; r < rules.length; r += 1) {
        const rule = rules[r];
        if (rule) css += rule.cssText + '\n';
      }
      stylesheets.push({
        href: absHref,
        css: rewriteCssUrls(css, opts.baseUrl, opts.resolveUrl),
      });
    } catch {
      // Accessing cssRules on a cross-origin sheet throws SecurityError.
      degraded.push({
        kind: 'cross-origin-stylesheet',
        detail: absHref ?? '(stylesheet rules blocked by CORS)',
      });
    }
  }

  return { stylesheets, degraded };
}

/**
 * Serialize a document into a snapshot node tree + inlined stylesheets +
 * degradation notes. Pure aside from reading the provided document. Never
 * throws on cross-origin CSS.
 */
export function serializeDocument(
  doc: MinimalDocument,
  options: SerializeOptions,
): SerializeResult {
  const resolveUrl = options.resolveUrl ?? defaultResolveUrl;
  const opts = {
    baseUrl: options.baseUrl,
    origin: options.origin,
    resolveUrl,
  };

  const rootNode = doc.documentElement ?? doc;
  const idRef = { next: 1 };
  const root =
    serializeNode(rootNode as MinimalNode, idRef, opts) ??
    ({ nodeId: 0, type: 'element', tag: 'html', attributes: {} } as SnapshotNode);

  const { stylesheets, degraded } = collectStylesheets(doc, opts);

  return { root, stylesheets, degraded };
}
