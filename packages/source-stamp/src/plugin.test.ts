import { describe, it, expect } from "vitest";

import sourceStamp from "./plugin.js";

const { ATTR, formatSource, relativeSourcePath, isFragmentName, hasStamp } =
  sourceStamp;

/**
 * A faithful, minimal mock of the `@babel/types` builders the plugin uses. The
 * shapes match real Babel AST node shapes closely enough that the plugin's own
 * `hasStamp` (which inspects `attr.type` / `attr.name.name`) treats the pushed
 * attribute exactly as it would a real one. This exercises the real visitor
 * code path without an `@babel/core` dependency (see vitest.config.ts).
 */
function mockTypes() {
  return {
    jsxIdentifier: (name: string) => ({ type: "JSXIdentifier", name }),
    jsxAttribute: (name: unknown, value: unknown) => ({
      type: "JSXAttribute",
      name,
      value,
    }),
    stringLiteral: (value: string) => ({ type: "StringLiteral", value }),
  };
}

/** Build a JSXOpeningElement path + plugin-pass state for the visitor. */
function jsxPath(opts: {
  name?: unknown;
  attributes?: unknown[];
  loc?: { start: { line: number; column: number } } | null;
  filename?: string | null;
  root?: string;
}) {
  const node = {
    type: "JSXOpeningElement",
    name: opts.name ?? { type: "JSXIdentifier", name: "div" },
    attributes: opts.attributes ?? [],
    loc: opts.loc === undefined ? { start: { line: 12, column: 4 } } : opts.loc,
  };
  const state = {
    file: {
      opts: {
        filename:
          opts.filename === undefined ? "/proj/src/App.tsx" : opts.filename,
        root: opts.root ?? "/proj",
      },
    },
  };
  return { path: { node }, state, node };
}

/** Run the plugin's JSXOpeningElement visitor against a fake path/state. */
function runVisitor(args: Parameters<typeof jsxPath>[0]) {
  const { path, state, node } = jsxPath(args);
  const plugin = sourceStamp({ types: mockTypes() });
  plugin.visitor.JSXOpeningElement(path, state);
  return node;
}

describe("formatSource", () => {
  it("joins path:line:col", () => {
    expect(formatSource("src/App.tsx", 12, 4)).toBe("src/App.tsx:12:4");
  });
});

describe("relativeSourcePath", () => {
  it("relativizes against the project root and forward-slashes", () => {
    expect(relativeSourcePath("/proj/src/components/Card.tsx", "/proj")).toBe(
      "src/components/Card.tsx",
    );
  });

  it("falls back to the original path when outside the root", () => {
    // `path.relative` would produce "../other.tsx" — still forward-slashed.
    expect(relativeSourcePath("/elsewhere/other.tsx", "/proj")).toContain(
      "other.tsx",
    );
  });
});

describe("isFragmentName", () => {
  it("detects <Fragment>", () => {
    expect(isFragmentName({ type: "JSXIdentifier", name: "Fragment" })).toBe(
      true,
    );
  });

  it("detects <React.Fragment>", () => {
    expect(
      isFragmentName({
        type: "JSXMemberExpression",
        object: { type: "JSXIdentifier", name: "React" },
        property: { type: "JSXIdentifier", name: "Fragment" },
      }),
    ).toBe(true);
  });

  it("is false for host/component elements", () => {
    expect(isFragmentName({ type: "JSXIdentifier", name: "div" })).toBe(false);
    expect(isFragmentName({ type: "JSXIdentifier", name: "Card" })).toBe(false);
  });
});

describe("hasStamp", () => {
  it("detects an existing data-sc-source attribute", () => {
    expect(
      hasStamp([
        { type: "JSXAttribute", name: { name: "id" } },
        { type: "JSXAttribute", name: { name: ATTR } },
      ]),
    ).toBe(true);
  });

  it("is false when absent", () => {
    expect(hasStamp([{ type: "JSXAttribute", name: { name: "id" } }])).toBe(
      false,
    );
  });
});

describe("plugin visitor", () => {
  it("appends data-sc-source=\"file:line:col\" to a plain element", () => {
    const node = runVisitor({});
    expect(node.attributes).toHaveLength(1);
    const attr = node.attributes[0] as {
      type: string;
      name: { name: string };
      value: { value: string };
    };
    expect(attr.type).toBe("JSXAttribute");
    expect(attr.name.name).toBe(ATTR);
    expect(attr.value.value).toBe("src/App.tsx:12:4");
  });

  it("does not duplicate the stamp when one already exists", () => {
    const node = runVisitor({
      attributes: [{ type: "JSXAttribute", name: { name: ATTR } }],
    });
    expect(node.attributes).toHaveLength(1);
  });

  it("skips <Fragment> elements", () => {
    const node = runVisitor({
      name: { type: "JSXIdentifier", name: "Fragment" },
    });
    expect(node.attributes).toHaveLength(0);
  });

  it("skips <React.Fragment> elements", () => {
    const node = runVisitor({
      name: {
        type: "JSXMemberExpression",
        object: { type: "JSXIdentifier", name: "React" },
        property: { type: "JSXIdentifier", name: "Fragment" },
      },
    });
    expect(node.attributes).toHaveLength(0);
  });

  it("stamps member-expression components (e.g. <Foo.Bar>)", () => {
    const node = runVisitor({
      name: {
        type: "JSXMemberExpression",
        object: { type: "JSXIdentifier", name: "Foo" },
        property: { type: "JSXIdentifier", name: "Bar" },
      },
    });
    expect(node.attributes).toHaveLength(1);
  });

  it("no-ops when the node has no source location", () => {
    const node = runVisitor({ loc: null });
    expect(node.attributes).toHaveLength(0);
  });

  it("no-ops when there is no filename (synthetic node)", () => {
    const node = runVisitor({ filename: null });
    expect(node.attributes).toHaveLength(0);
  });
});
