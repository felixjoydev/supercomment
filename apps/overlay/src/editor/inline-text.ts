/**
 * Inline text editing (requirement E).
 *
 * Double-clicking a TEXT-LEAF element makes it directly editable
 * (`contenteditable="plaintext-only"`, so the reviewer can only change the text,
 * never paste markup or clobber child structure). Committing on blur or Enter
 * records a `setText` op with the NORMALIZED before→after; Escape cancels and
 * restores the original text. The visual change is an ephemeral preview like
 * every other editor edit — the controller registers a revert with the
 * PreviewLog.
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
 * Begin an inline text edit on `el`. Returns a handle (or null when `el` isn't a
 * safe text leaf). Commits on blur / Enter, cancels on Escape.
 */
export function beginInlineTextEdit(
  el: Element,
  doc: Document,
  opts: InlineTextOptions,
): InlineTextHandle | null {
  if (!isEditableTextLeaf(el)) return null;

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
        ke.preventDefault?.();
        finish(true);
      } else if (ke.key === "Escape") {
        ke.preventDefault?.();
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
