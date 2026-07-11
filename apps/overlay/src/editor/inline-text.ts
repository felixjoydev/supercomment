/**
 * Inline text editing (requirement E).
 *
 * Double-clicking a TEXT-LEAF element makes it directly editable
 * (`contenteditable="plaintext-only"`, so the reviewer can only change the text,
 * never paste markup or clobber child structure). Committing on blur or Enter
 * records a `setText` op with the NORMALIZED before→after; Escape cancels and
 * restores the original text. The visual change is an ephemeral preview like
 * every other editor edit — the controller records it into the history engine
 * with its redo/undo/revert-to-build closures (U3).
 *
 * Leaf-only (no element children) is the safety rule: editing the text of a node
 * with children would blow away those children (G12). Never throws; returns null
 * when the element isn't a safe text leaf.
 */
import { applyTextPreview, readText } from "./style-edits.js";

export interface InlineTextOptions {
  /** Fired with the normalized original + new text when the edit is committed. */
  onCommit(before: string, after: string): void;
  /** Fired when the edit is cancelled (Escape); the original text is restored. */
  onCancel?(): void;
}

export interface InlineTextHandle {
  /** Force-cancel the edit (restore original text, remove editability). */
  cancel(): void;
}

/** A safe inline-edit target: a leaf (no element children) with visible text. */
export function isEditableTextLeaf(el: Element): boolean {
  try {
    const childCount = el.children?.length ?? 0;
    if (childCount > 0) return false;
    return (el.textContent ?? "").trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Inline (phrasing) tags whose presence as children still makes an element safe
 * to edit as plain text — a paragraph with a link or bold run is a text block, not
 * a structural container. A child that is NOT one of these (a `div`, `p`, `ul`,
 * `img`, …) means the element owns real structure we must not flatten.
 */
const PHRASING_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i",
  "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup",
  "time", "u", "var", "wbr", "label",
]);

/**
 * A broader safe inline-edit target: an element with visible text whose children
 * (if any) are ALL phrasing/inline elements — so a `<p>Read the <a>docs</a></p>`
 * or a `<div>` of inline runs is editable, but a container with block children
 * (which editing would flatten, G12) is not. A strict leaf is the empty-children
 * case of this rule.
 */
export function isEditableText(el: Element): boolean {
  try {
    if ((el.textContent ?? "").trim().length === 0) return false;
    const children = Array.from(el.children ?? []);
    return children.every((c) => PHRASING_TAGS.has((c.tagName || "").toLowerCase()));
  } catch {
    return false;
  }
}

/**
 * Begin an inline text edit on `el`. Returns a handle (or null when `el` isn't a
 * safe text leaf). Commits on blur / Enter, cancels on Escape.
 */
export function beginInlineTextEdit(
  el: Element,
  doc: Document,
  opts: InlineTextOptions,
): InlineTextHandle | null {
  if (!isEditableText(el)) return null;

  const before = readText(el);
  try {
    el.setAttribute("contenteditable", "plaintext-only");
  } catch {
    /* older engines: fall back below still works, edit is just richer */
  }
  focusAndSelect(el, doc);

  let done = false;
  const disposers: Array<() => void> = [];
  const cleanup = (): void => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* best-effort */
      }
    }
  };

  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    try {
      el.removeAttribute("contenteditable");
    } catch {
      /* best-effort */
    }
    cleanup();
    if (commit) {
      opts.onCommit(before, readText(el));
    } else {
      applyTextPreview(el, before); // restore the original text
      opts.onCancel?.();
    }
  };

  listen(el, "blur", () => finish(true), disposers);
  listen(
    el,
    "keydown",
    (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" && !ke.shiftKey) {
        // Claim the innermost Escape/commit layer (U2): stop the key from bubbling
        // to the controller's document handler, so committing/cancelling an inline
        // text edit never also closes the whole editor.
        ke.preventDefault?.();
        ke.stopPropagation?.();
        finish(true);
      } else if (ke.key === "Escape") {
        ke.preventDefault?.();
        ke.stopPropagation?.();
        finish(false);
      }
    },
    disposers,
  );

  return { cancel: () => finish(false) };
}

/** Focus the element and select all its text so the reviewer can retype. Best-effort. */
function focusAndSelect(el: Element, doc: Document): void {
  try {
    (el as HTMLElement).focus?.();
  } catch {
    /* best-effort */
  }
  try {
    const view = doc.defaultView as
      | {
          getSelection?: () => {
            removeAllRanges?: () => void;
            addRange?: (r: unknown) => void;
          } | null;
        }
      | undefined;
    const createRange = (doc as { createRange?: () => unknown }).createRange;
    const sel = view?.getSelection?.();
    if (typeof createRange === "function" && sel) {
      const range = createRange.call(doc) as {
        selectNodeContents?: (n: Element) => void;
      };
      range.selectNodeContents?.(el);
      sel.removeAllRanges?.();
      sel.addRange?.(range);
    }
  } catch {
    /* selection is a nicety; typing still works without it */
  }
}

type Listener = (e: unknown) => void;

function listen(
  target: { addEventListener(t: string, h: Listener): void; removeEventListener?(t: string, h: Listener): void },
  type: string,
  handler: Listener,
  disposers: Array<() => void>,
): void {
  target.addEventListener(type, handler);
  disposers.push(() => target.removeEventListener?.(type, handler));
}
