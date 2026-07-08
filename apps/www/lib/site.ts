/**
 * Site-wide constants and structure for the SuperComment marketing site.
 *
 * Canonical host is https://supercomment.dev (no trailing slash, www -> apex).
 * The app (signup / dashboard) lives on app.supercomment.dev; docs under /docs.
 */

export const SITE_URL = "https://supercomment.dev";
export const APP_URL = "https://app.supercomment.dev";
export const DOCS_URL = "/docs";

/** Conversion targets. The site's job ends at signup; onboarding carries on. */
export const START_FREE_URL = `${APP_URL}/signup`;
export const SIGN_IN_URL = `${APP_URL}/login`;

export const CONTACT = {
  hello: "hello@supercomment.dev",
  security: "security@supercomment.dev",
  integrations: "integrations@supercomment.dev",
} as const;

/**
 * Two homepages, one codebase. `/` renders the variant named by
 * NEXT_PUBLIC_SITE_VERSION (v1 | v2), defaulting to v2. Two Vercel deploys of
 * the same repo therefore produce two complete sites; both variants are also
 * always reachable at /preview/home-v1 and /preview/home-v2 (noindex).
 */
export type SiteVersion = "v1" | "v2";
export const SITE_VERSION: SiteVersion =
  process.env.NEXT_PUBLIC_SITE_VERSION === "v1" ? "v1" : "v2";

/**
 * The single source of truth for integration launch state. Flip any value to
 * "coming-soon" in one line and every card, hub row, and child page follows.
 * Per the 2026-07-03 claims audit: GitHub, Slack, Linear ship live; Jira later.
 */
export type IntegrationStatus = "live" | "coming-soon";
export const integrationStatus: Record<
  "github" | "slack" | "linear" | "jira",
  IntegrationStatus
> = {
  github: "live",
  slack: "live",
  linear: "live",
  jira: "coming-soon",
};

export type NavLink = { label: string; href: string };
export type NavGroup = { label: string; items: NavLink[] };

export const productNav: NavGroup = {
  label: "Product",
  items: [
    { label: "How it works", href: "/how-it-works" },
    { label: "Visual edits", href: "/visual-edits" },
    { label: "Agent handoff", href: "/agent-handoff" },
    { label: "MCP server", href: "/mcp" },
    { label: "Integrations", href: "/integrations" },
    { label: "Security", href: "/security" },
  ],
};

export const useCasesNav: NavGroup = {
  label: "Use cases",
  items: [
    { label: "Solo founders", href: "/for/solo-founders" },
    { label: "Product teams", href: "/for/product-teams" },
    { label: "Agencies", href: "/for/agencies" },
  ],
};

/** Footer columns, exactly as 02-ia.md section 3. */
export const footerColumns: { heading: string; items: (NavLink & { muted?: boolean })[] }[] = [
  {
    heading: "Product",
    items: [
      { label: "How it works", href: "/how-it-works" },
      { label: "Visual edits", href: "/visual-edits" },
      { label: "Agent handoff", href: "/agent-handoff" },
      { label: "MCP server", href: "/mcp" },
      { label: "Integrations", href: "/integrations" },
    ],
  },
  {
    heading: "Use cases",
    items: [
      { label: "Solo founders", href: "/for/solo-founders" },
      { label: "Product teams", href: "/for/product-teams" },
      { label: "Agencies", href: "/for/agencies" },
    ],
  },
  {
    heading: "Compare",
    items: [
      { label: "vs BugHerd", href: "/compare/bugherd" },
      { label: "vs Marker.io", href: "/compare/marker-io" },
      { label: "vs Vercel Comments", href: "/compare/vercel-comments" },
      { label: "vs Jam", href: "/compare/jam" },
      { label: "vs Screenshots in Slack", href: "/compare/screenshots-in-slack" },
    ],
  },
  {
    heading: "Company",
    items: [
      { label: "Manifesto", href: "/manifesto" },
      { label: "About", href: "/about" },
      { label: "Pricing", href: "/pricing" },
      { label: "Security", href: "/security" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
  {
    heading: "Resources",
    items: [
      { label: "Docs", href: DOCS_URL },
      { label: "Blog", href: "/blog" },
      { label: "Changelog", href: "/changelog" },
      { label: "FAQ", href: "/faq" },
      { label: "Status", href: "/status", muted: true },
    ],
  },
];

export const FOOTER_SIGNOFF = "Feedback should stay attached to the product.";
