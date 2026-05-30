/**
 * Minimal DOM double for capture tests.
 *
 * jsdom is not loadable in this sandbox (its transitive `html-encoding-sniffer`
 * does a CommonJS require of an ESM-only module), so vitest falls back to the
 * `node` environment — there is no global `document`. The overlay's existing
 * tests already cope with this by driving a hand-rolled DOM double; the capture
 * modules follow the same approach.
 *
 * This double implements only the surface the capture code touches:
 *   - element: tagName, id, getAttribute, attributes, textContent,
 *     parentElement, children, nodeType, ownerDocument, outerHTML,
 *     getBoundingClientRect
 *   - document: querySelectorAll (id / [attr="v"] / tag / tag:nth-of-type(n) /
 *     tag:nth-child(n) and ` > ` combinators), defaultView
 *   - window: innerWidth/innerHeight, devicePixelRatio, location, getComputedStyle
 *
 * It is deliberately small and only as correct as the tests require.
 */

export interface FakeAttr {
  name: string;
  value: string;
}

export interface BuildSpec {
  tag: string;
  id?: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: BuildSpec[];
  rect?: { x: number; y: number; width: number; height: number };
}

export class FakeElement {
  readonly tagName: string;
  readonly nodeType = 1;
  id = "";
  parentElement: FakeElement | null = null;
  ownerDocument: FakeDocument | null = null;
  private readonly attrMap = new Map<string, string>();
  private readonly kids: FakeElement[] = [];
  private text = "";
  private rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 };

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get children(): FakeElement[] {
    return this.kids;
  }

  get attributes(): FakeAttr[] {
    return [...this.attrMap.entries()].map(([name, value]) => ({
      name,
      value,
    }));
  }

  setAttribute(name: string, value: string): void {
    if (name === "id") {
      this.id = value;
    }
    this.attrMap.set(name, value);
  }

  getAttribute(name: string): string | null {
    if (name === "id") {
      return this.id || null;
    }
    return this.attrMap.has(name) ? (this.attrMap.get(name) as string) : null;
  }

  setText(text: string): void {
    this.text = text;
  }

  setRect(rect: { x: number; y: number; width: number; height: number }): void {
    this.rect = { ...rect, top: rect.y, left: rect.x };
  }

  appendChild(child: FakeElement): void {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.kids.push(child);
  }

  get textContent(): string {
    if (this.kids.length === 0) {
      return this.text;
    }
    return this.text + this.kids.map((k) => k.textContent).join("");
  }

  getBoundingClientRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
  } {
    return { ...this.rect };
  }

  get outerHTML(): string {
    const attrs = this.attributes
      .map((a) => `${a.name}="${a.value}"`)
      .join(" ");
    const open = attrs
      ? `<${this.tagName.toLowerCase()} ${attrs}>`
      : `<${this.tagName.toLowerCase()}>`;
    const inner =
      this.text + this.kids.map((k) => k.outerHTML).join("");
    return `${open}${inner}</${this.tagName.toLowerCase()}>`;
  }

  /** All descendants (depth-first), including self optionally. */
  descendants(includeSelf = false): FakeElement[] {
    const out: FakeElement[] = includeSelf ? [this] : [];
    for (const k of this.kids) {
      out.push(k, ...k.descendants());
    }
    return out;
  }
}

export class FakeWindow {
  innerWidth = 1024;
  innerHeight = 768;
  devicePixelRatio = 2;
  location = { href: "https://app.example.com/page?x=1" };
  document: FakeDocument;

  constructor(doc: FakeDocument) {
    this.document = doc;
  }

  getComputedStyle(_el: FakeElement): {
    getPropertyValue(prop: string): string;
  } {
    const map: Record<string, string> = {
      display: "block",
      position: "static",
      color: "rgb(0, 0, 0)",
      "font-size": "16px",
    };
    return {
      getPropertyValue: (prop: string) => map[prop] ?? "",
    };
  }
}

export class FakeDocument {
  root: FakeElement;
  defaultView: FakeWindow;

  constructor(root: FakeElement) {
    this.root = root;
    this.defaultView = new FakeWindow(this);
  }

  private all(): FakeElement[] {
    return this.root.descendants(true);
  }

  querySelectorAll(selector: string): FakeElement[] {
    // Support a space-separated " > " chain; we match the *last* segment and
    // verify each ancestor segment up the parent chain.
    const parts = selector.split(">").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) {
      return [];
    }
    const last = parts[parts.length - 1] ?? "";
    const candidates = this.all().filter((el) => this.matchSegment(el, last));
    if (parts.length === 1) {
      return candidates;
    }
    return candidates.filter((el) =>
      this.matchAncestorChain(el, parts.slice(0, -1)),
    );
  }

  private matchAncestorChain(el: FakeElement, ancestors: string[]): boolean {
    let node: FakeElement | null = el.parentElement;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const seg = ancestors[i] ?? "";
      while (node && !this.matchSegment(node, seg)) {
        node = node.parentElement;
      }
      if (!node) {
        return false;
      }
      node = node.parentElement;
    }
    return true;
  }

  private matchSegment(el: FakeElement, seg: string): boolean {
    const tag = el.tagName.toLowerCase();

    // #id
    if (seg.startsWith("#")) {
      return el.id === seg.slice(1);
    }
    // tag#id
    const idHash = seg.match(/^([a-z0-9]+)#(.+)$/i);
    if (idHash) {
      return tag === (idHash[1] ?? "").toLowerCase() && el.id === idHash[2];
    }
    // tag[attr="value"]
    const attrMatch = seg.match(/^([a-z0-9*]+)\[([^=]+)="(.*)"\]$/i);
    if (attrMatch) {
      const segTag = attrMatch[1] ?? "*";
      const attr = attrMatch[2] ?? "";
      const value = attrMatch[3] ?? "";
      const tagOk = segTag === "*" || tag === segTag.toLowerCase();
      return tagOk && el.getAttribute(attr) === value;
    }
    // tag:nth-of-type(n)
    const nthType = seg.match(/^([a-z0-9]+):nth-of-type\((\d+)\)$/i);
    if (nthType) {
      if (tag !== (nthType[1] ?? "").toLowerCase()) {
        return false;
      }
      const parent = el.parentElement;
      if (!parent) {
        return false;
      }
      const sameTag = parent.children.filter((c) => c.tagName === el.tagName);
      return sameTag.indexOf(el) + 1 === Number(nthType[2]);
    }
    // tag:nth-child(n)
    const nthChild = seg.match(/^([a-z0-9]+):nth-child\((\d+)\)$/i);
    if (nthChild) {
      if (tag !== (nthChild[1] ?? "").toLowerCase()) {
        return false;
      }
      const parent = el.parentElement;
      if (!parent) {
        return false;
      }
      return parent.children.indexOf(el) + 1 === Number(nthChild[2]);
    }
    // bare tag
    return tag === seg.toLowerCase();
  }
}

/** Build a tree from a {@link BuildSpec} and return its document + root. */
export function buildDom(spec: BuildSpec): {
  doc: FakeDocument;
  root: FakeElement;
} {
  const root = buildElement(spec);
  const doc = new FakeDocument(root);
  // Wire ownerDocument through the whole tree.
  for (const el of root.descendants(true)) {
    el.ownerDocument = doc;
  }
  return { doc, root };
}

function buildElement(spec: BuildSpec): FakeElement {
  const el = new FakeElement(spec.tag);
  if (spec.id) {
    el.setAttribute("id", spec.id);
  }
  if (spec.attrs) {
    for (const [k, v] of Object.entries(spec.attrs)) {
      el.setAttribute(k, v);
    }
  }
  if (spec.text) {
    el.setText(spec.text);
  }
  if (spec.rect) {
    el.setRect(spec.rect);
  }
  if (spec.children) {
    for (const childSpec of spec.children) {
      el.appendChild(buildElement(childSpec));
    }
  }
  return el;
}

/** Find the first descendant (incl. self) with the given id. */
export function byId(root: FakeElement, id: string): FakeElement {
  const found = root.descendants(true).find((el) => el.id === id);
  if (!found) {
    throw new Error(`no element with id="${id}"`);
  }
  return found;
}

/** Find the first descendant (incl. self) with the given tag. */
export function byTag(root: FakeElement, tag: string): FakeElement {
  const found = root
    .descendants(true)
    .find((el) => el.tagName.toLowerCase() === tag.toLowerCase());
  if (!found) {
    throw new Error(`no <${tag}> element`);
  }
  return found;
}

/** All descendants (incl. self) with the given tag. */
export function allByTag(root: FakeElement, tag: string): FakeElement[] {
  return root
    .descendants(true)
    .filter((el) => el.tagName.toLowerCase() === tag.toLowerCase());
}
