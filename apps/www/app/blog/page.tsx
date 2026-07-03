import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { blogPosts } from "@/lib/content/blog";

const META = {
  title: "SuperComment Blog",
  description:
    "Writing on visual feedback, AI coding agents, and closing the loop from comment to fix. The first posts are on the way.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/blog" });

export default function BlogPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
        ]}
        title="The SuperComment blog."
        answer="Writing on visual feedback, agent-ready context, and shipping fixes through AI coding agents. The first posts are on the way; here is what is planned."
        schemaDescription={META.description}
      />

      <Section>
        <p className="text-sm">
          <a
            href="/blog/rss.xml"
            className="font-medium text-ink underline underline-offset-4"
          >
            RSS feed
          </a>
        </p>

        <ul className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
          {blogPosts.map((post) => (
            <li key={post.slug} className="flex items-center justify-between gap-4 py-5">
              <div>
                <p className="font-medium text-ink">{post.title}</p>
                <p className="mt-1 text-sm text-ink-3">{post.target}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-3">
                <span className="h-1.5 w-1.5 rounded-full bg-backlog-dot" />
                Planned
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
