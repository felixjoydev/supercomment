import type { ReactNode } from "react";
import { JsonLd } from "./JsonLd";
import { faqPageLd, type QA } from "@/lib/seo";

/**
 * A plain disclosure list, no icons. Native details/summary so it works with
 * zero JS. When `plainText` items are supplied, FAQPage schema is emitted for
 * exactly what is shown, keeping the visible copy and the schema in sync.
 */
export function FaqList({
  items,
  schema = true,
}: {
  items: QA[];
  schema?: boolean;
}) {
  return (
    <div>
      {schema ? <JsonLd data={faqPageLd(items)} /> : null}
      <dl className="border-t border-line">
        {items.map((it) => (
          <details key={it.q} className="border-b border-line">
            <summary className="flex cursor-pointer list-none py-4 text-base font-medium text-ink marker:content-['']">
              {it.q}
            </summary>
            <div className="pb-5 text-ink-2 measure">{it.a}</div>
          </details>
        ))}
      </dl>
    </div>
  );
}

/**
 * Some FAQ answers carry a link (e.g. "[See comparisons →]"). This variant
 * accepts rich answers for display while still emitting a plain-text schema
 * payload for the crawler.
 */
export function RichFaqList({
  items,
}: {
  items: { q: string; a: ReactNode; text: string }[];
}) {
  return (
    <div>
      <JsonLd data={faqPageLd(items.map((it) => ({ q: it.q, a: it.text })))} />
      <dl className="border-t border-line">
        {items.map((it) => (
          <details key={it.q} className="border-b border-line">
            <summary className="flex cursor-pointer list-none py-4 text-base font-medium text-ink marker:content-['']">
              {it.q}
            </summary>
            <div className="pb-5 text-ink-2 measure">{it.a}</div>
          </details>
        ))}
      </dl>
    </div>
  );
}
