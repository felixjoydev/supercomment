import type { Metadata } from "next";
import { pageMetadata, articleLd } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { JsonLd } from "@/components/site/JsonLd";
import { changelog } from "@/lib/content/changelog";

const META = {
  title: "SuperComment Changelog",
  description:
    "What shipped, dated. New capabilities, fixes, and honest notes from the team building SuperComment.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/changelog" });

export default function ChangelogPage() {
  return (
    <>
      <JsonLd
        data={changelog.map((e) =>
          articleLd({
            headline: e.title,
            datePublished: e.date,
            path: `/changelog#${e.slug}`,
          }),
        )}
      />
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Changelog", path: "/changelog" },
        ]}
        title="Changelog."
        answer="What shipped, dated. New capabilities, fixes, and honest notes from the team building SuperComment. Subscribe to the RSS feed to follow along."
        schemaDescription={META.description}
      />

      <Section>
        <p className="text-sm">
          <a
            href="/changelog/rss.xml"
            className="font-medium text-ink underline underline-offset-4"
          >
            RSS feed
          </a>
        </p>

        <div className="mt-8 space-y-12">
          {changelog.map((entry) => (
            <article key={entry.slug} id={entry.slug} className="scroll-mt-24">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-2xl">{entry.title}</h2>
                <span className="font-mono text-sm text-ink-3 tnum">
                  {entry.label}
                </span>
              </div>
              <div className="prose mt-5 max-w-2xl">
                <ul>
                  {entry.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </Section>
    </>
  );
}
