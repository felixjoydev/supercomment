import type { MetadataRoute } from "next";
import { sitemapRoutes } from "@/lib/routes";
import { absUrl } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return sitemapRoutes.map((r) => ({
    url: absUrl(r.path),
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
