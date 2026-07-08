import { buildRss } from "@/lib/rss";
import { changelog } from "@/lib/content/changelog";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const xml = buildRss({
    title: "SuperComment Changelog",
    path: "/changelog/rss.xml",
    description: "What shipped, dated. New capabilities, fixes, and honest notes.",
    items: changelog.map((e) => ({
      title: e.title,
      link: `${SITE_URL}/changelog#${e.slug}`,
      guid: `${SITE_URL}/changelog#${e.slug}`,
      pubDate: new Date(e.date).toUTCString(),
      description: e.bullets.join(" "),
    })),
  });
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
