/**
 * Minimal DOM test double.
 *
 * The overlay is designed to run under a real browser / jsdom, and the vitest
 * config requests `jsdom` when it is installed. In sandboxed CI where jsdom
 * cannot be installed, this lightweight double provides just enough of the DOM
 * surface the overlay uses (elements, attributes, a shadow root, class-based
 * querying, event listeners, getBoundingClientRect) so the unit tests still
 * exercise the real rendering + isolation code paths.
 *
 * It is intentionally NOT a spec-complete DOM — only what these tests touch.
 */

export interface DOMRectLike {
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

let rectProvider: (el: FakeElement) => DOMRectLike = (_el) =>
  makeRect(0, 0, 10, 10);

/** Override how elements report their geometry (per test). */
export function setRectProvider(fn: (el: FakeElement) => DOMRectLike): void {
  rectProvider = fn;
}

type Listener = (e: unknown) => void;

/**
 * Match a *simple* selector (one compound, no combinators) against an element.
 * Supports a tag name and/or one-or-more `.class` tokens, e.g. "textarea",
 * ".sc-form", "button.sc-btn-primary". Enough for the overlay's own queries.
 */
function matchesSimple(el: FakeElement, selector: string): boolean {
  const sel = selector.trim();
  if (!sel) return false;
  // Split a leading tag from any trailing ".class" tokens.
  const firstDot = sel.indexOf(".");
  const tag = firstDot === -1 ? sel : sel.slice(0, firstDot);
  const classPart = firstDot === -1 ? "" : sel.slice(firstDot);
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (classPart) {
    const want = classPart
      .split(".")
      .map((s) => s.trim())
      .filter(Boolean);
    const have = el.className.split(/\s+/).filter(Boolean);
    if (!want.every((c) => have.includes(c))) return false;
  }
  return true;
}

/**
 * Match a selector that may contain ONE descendant combinator, e.g.
 * ".sc-modal input": the element must match the last compound and have an
 * ancestor matching the first. Only the depth this overlay actually uses is
 * supported.
 */
function matchesClasses(el: FakeElement, selector: string): boolean {
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return matchesSimple(el, parts[0]!);
  const last = parts[parts.length - 1]!;
  if (!matchesSimple(el, last)) return false;
  // Every preceding compound must be found on some ancestor (in order).
  let ancestor = el.parent;
  let idx = parts.length - 2;
  while (ancestor && idx >= 0) {
    if (matchesSimple(ancestor, parts[idx]!)) idx--;
    ancestor = ancestor.parent;
  }
  return idx < 0;
}

function collect(el: FakeElement, out: FakeElement[]): void {
  for (const c of el.children) {
    out.push(c);
    collect(c, out);
  }
}

export class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  shadowRoot: FakeShadowRoot | null = null;
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, Listener[]>();
  private text = "";
  className = "";
  value = "";
  type = "";
  placeholder = "";
  title = "";
  disabled = false;
  id = "";

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    if (this.children.length === 0) return this.text;
    return this.children.map((c) => c.textContent).join("");
  }

  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") this.id = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeElement[]): void {
    for (const n of nodes) this.appendChild(n);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  get childElementCount(): number {
    return this.children.length;
  }

  /** Element node type (always 1); lets capture code walk this double like a real tree. */
  get nodeType(): number {
    return 1;
  }

  /** The parent element, mirroring the real DOM accessor used by selector/anchor capture. */
  get parentElement(): FakeElement | null {
    return this.parent;
  }

  contains(node: FakeElement | null): boolean {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }

  closest(selector: string): FakeElement | null {
    const sel = selector.trim();
    const id = sel.startsWith("#") ? sel.slice(1) : null;
    let cur: FakeElement | null = this;
    while (cur) {
      if (id) {
        if (cur.id === id) return cur;
      } else if (matchesSimple(cur, sel)) {
        // Supports tag/.class compounds (e.g. ".sc-marker"); attribute and other
        // selectors fall through to no match, as before.
        return cur;
      }
      cur = cur.parent;
    }
    return null;
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((f) => f !== fn));
  }

  dispatch(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  focus(): void {
    // no-op
  }

  attachShadow(): FakeShadowRoot {
    this.shadowRoot = new FakeShadowRoot();
    return this.shadowRoot;
  }

  getBoundingClientRect(): DOMRectLike {
    return rectProvider(this);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const all: FakeElement[] = [];
    collect(this, all);
    return all.filter((el) => matchesClasses(el, selector));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export class FakeShadowRoot {
  children: FakeElement[] = [];

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    child.parent = null;
    return child;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const all: FakeElement[] = [];
    for (const c of this.children) {
      all.push(c);
      collect(c, all);
    }
    return all.filter((el) => matchesClasses(el, selector));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export class FakeDocument {
  readonly body: FakeElement;
  readonly documentElement: FakeElement;
  defaultView: FakeWindow;
  readyState = "complete";
  private readonly docListeners = new Map<string, Listener[]>();

  constructor(view: FakeWindow) {
    this.defaultView = view;
    this.documentElement = new FakeElement("html");
    this.body = new FakeElement("body");
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }

  getElementById(id: string): FakeElement | null {
    const all: FakeElement[] = [];
    collect(this.documentElement, all);
    return all.find((e) => e.id === id) ?? null;
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.docListeners.get(type) ?? [];
    list.push(fn);
    this.docListeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.docListeners.get(type);
    if (list) this.docListeners.set(type, list.filter((f) => f !== fn));
  }

  dispatch(type: string, event: unknown): void {
    for (const fn of this.docListeners.get(type) ?? []) fn(event);
  }
}

export class FakeWindow {
  innerWidth = 1024;
  innerHeight = 768;
  private readonly listeners = new Map<string, Listener[]>();
  private selectionText = "";
  private selectionRect: DOMRectLike | null = null;

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((f) => f !== fn));
  }

  dispatch(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  setTextSelection(text: string, rect: DOMRectLike): void {
    this.selectionText = text;
    this.selectionRect = rect;
  }

  getSelection(): {
    toString(): string;
    rangeCount: number;
    getRangeAt(): { getBoundingClientRect(): DOMRectLike };
  } {
    const rect = this.selectionRect ?? makeRect(0, 0, 0, 0);
    const text = this.selectionText;
    return {
      toString: () => text,
      rangeCount: text ? 1 : 0,
      getRangeAt: () => ({ getBoundingClientRect: () => rect }),
    };
  }
}

/** Build a wired document + window double. */
export function makeFakeDom(): { doc: FakeDocument; win: FakeWindow } {
  const win = new FakeWindow();
  const doc = new FakeDocument(win);
  return { doc, win };
}

export function makeRect(
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRectLike {
  return {
    x,
    y,
    left: x,
    top: y,
    width,
    height,
    right: x + width,
    bottom: y + height,
  };
}
