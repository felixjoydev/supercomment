import { SITE_URL } from "./site";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type RssItem = {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  description: string;
};

export function buildRss(input: {
  title: string;
  path: string;
  description: string;
  items: RssItem[];
}): string {
  const self = `${SITE_URL}${input.path}`;
  const items = input.items
    .map(
      (it) => `    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${escapeXml(it.link)}</link>
      <guid isPermaLink="false">${escapeXml(it.guid)}</guid>
      <pubDate>${it.pubDate}</pubDate>
      <description>${escapeXml(it.description)}</description>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(input.title)}</title>
    <link>${escapeXml(`${SITE_URL}${input.path.replace(/\/rss\.xml$/, "")}`)}</link>
    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(input.description)}</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`;
}
