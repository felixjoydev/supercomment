import Link from "next/link";
import { JsonLd } from "./JsonLd";
import { breadcrumbLd, type Crumb } from "@/lib/seo";

/** Visible breadcrumb trail plus BreadcrumbList schema. Last crumb is current. */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <>
      <JsonLd data={breadcrumbLd(crumbs)} />
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-3">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={c.path} className="flex items-center gap-1.5">
                {last ? (
                  <span className="text-ink-2">{c.name}</span>
                ) : (
                  <Link href={c.path} className="hover:text-ink transition-colors">
                    {c.name}
                  </Link>
                )}
                {last ? null : <span aria-hidden="true">/</span>}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
