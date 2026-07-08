import { buildRss } from "@/lib/rss";
import { blogPosts } from "@/lib/content/blog";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  // Only published posts appear in the feed. None yet: a valid, empty channel.
  const published = blogPosts.filter((p) => p.status === "published");
  const xml = buildRss({
    title: "SuperComment Blog",
    path: "/blog/rss.xml",
    description:
      "Writing on visual feedback, AI coding agents, and closing the loop from comment to fix.",
    items: published.map((p) => ({
      title: p.title,
      link: `${SITE_URL}/blog/${p.slug}`,
      guid: `${SITE_URL}/blog/${p.slug}`,
      pubDate: new Date("2026-07-01").toUTCString(),
      description: p.title,
    })),
  });
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
