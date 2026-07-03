/**
 * The indexable route list, single source of truth for the sitemap and the
 * llms-full corpus. Excludes /preview/* (noindex), /docs (noindex stub), and
 * 404. Ordered by importance.
 */
export type SitemapRoute = {
  path: string;
  priority: number;
  changeFrequency:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
};

export const sitemapRoutes: SitemapRoute[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/how-it-works", priority: 0.9, changeFrequency: "monthly" },
  { path: "/agent-handoff", priority: 0.9, changeFrequency: "monthly" },
  { path: "/mcp", priority: 0.9, changeFrequency: "monthly" },
  { path: "/visual-edits", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/security", priority: 0.7, changeFrequency: "monthly" },
  { path: "/integrations", priority: 0.7, changeFrequency: "monthly" },
  { path: "/integrations/github", priority: 0.6, changeFrequency: "monthly" },
  { path: "/integrations/slack", priority: 0.6, changeFrequency: "monthly" },
  { path: "/integrations/linear", priority: 0.6, changeFrequency: "monthly" },
  { path: "/integrations/jira", priority: 0.5, changeFrequency: "monthly" },
  { path: "/for/solo-founders", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/product-teams", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/agencies", priority: 0.7, changeFrequency: "monthly" },
  { path: "/compare", priority: 0.8, changeFrequency: "monthly" },
  { path: "/compare/bugherd", priority: 0.8, changeFrequency: "monthly" },
  { path: "/compare/marker-io", priority: 0.8, changeFrequency: "monthly" },
  { path: "/compare/vercel-comments", priority: 0.8, changeFrequency: "monthly" },
  { path: "/compare/jam", priority: 0.7, changeFrequency: "monthly" },
  { path: "/compare/screenshots-in-slack", priority: 0.7, changeFrequency: "monthly" },
  { path: "/manifesto", priority: 0.6, changeFrequency: "yearly" },
  { path: "/about", priority: 0.6, changeFrequency: "yearly" },
  { path: "/faq", priority: 0.7, changeFrequency: "monthly" },
  { path: "/changelog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/blog", priority: 0.5, changeFrequency: "weekly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];
