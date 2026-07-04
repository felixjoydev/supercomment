/**
 * Page-index model (U12): fold a preview's loaded comments into per-page entries
 * for the overlay popover. Groups on the SAME page key the dashboard uses
 * (pageKeyOf(context.url)) so both surfaces agree on what "a page" is. Pure and
 * dependency-free (no DOM) so it is node-testable.
 */
import { pageKeyOf } from "@supercomment/shared";
import type { ReviewComment } from "../read/load-comments.js";

export interface PageEntry {
  /** Normalized page key (pathname); the unknown bucket does not start with "/". */
  key: string;
  /** Human label (path, "Home", or "Other"). */
  label: string;
  /** Path for same-origin navigation, or null for the unknown bucket. */
  path: string | null;
  count: number;
  unreadCount: number;
  hasUnread: boolean;
  /** True when this is the page the overlay is currently on. */
  isCurrent: boolean;
}

function urlOf(c: ReviewComment): string | null {
  const u = (c.context as { url?: unknown }).url;
  return typeof u === "string" ? u : null;
}

/**
 * Group comments into page entries. Ordering: the current page first, then pages
 * with unread, then alphabetical, with the unparseable "Other" bucket last.
 */
export function groupPagesForIndex(
  comments: ReviewComment[],
  currentUrl: string,
): PageEntry[] {
  const currentKey = pageKeyOf(currentUrl).key;
  const byKey = new Map<string, PageEntry>();
  for (const c of comments) {
    const pk = pageKeyOf(urlOf(c));
    let e = byKey.get(pk.key);
    if (!e) {
      e = {
        key: pk.key,
        label: pk.label,
        path: pk.key.startsWith("/") ? pk.key : null,
        count: 0,
        unreadCount: 0,
        hasUnread: false,
        isCurrent: pk.key === currentKey,
      };
      byKey.set(pk.key, e);
    }
    e.count += 1;
    if (c.unread) {
      e.unreadCount += 1;
      e.hasUnread = true;
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const aOther = !a.key.startsWith("/");
    const bOther = !b.key.startsWith("/");
    if (aOther !== bOther) return aOther ? 1 : -1;
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.hasUnread !== b.hasUnread) return a.hasUnread ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}
