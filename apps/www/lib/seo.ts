import type { Metadata } from "next";
import { SITE_URL } from "./site";
import { DESC_25 } from "./copy";

/** Absolute canonical URL for a path. No trailing slash (except root). */
export function absUrl(path: string): string {
  if (path === "/" || path === "") return SITE_URL;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${clean.replace(/\/$/, "")}`;
}

export type PageMetaInput = {
  title: string;
  description: string;
  path: string;
  ogTitle?: string;
  /** twitter/OG type. Defaults to "website". */
  type?: "website" | "article";
  noindex?: boolean;
};

/** Pick the OG image by page-family: home, feature, compare, pricing. */
function ogImageForPath(path: string): string {
  if (path.startsWith("/compare")) return "/og/compare.png";
  if (path === "/pricing") return "/og/pricing.png";
  const featurePrefixes = [
    "/how-it-works",
    "/visual-edits",
    "/agent-handoff",
    "/mcp",
    "/integrations",
    "/security",
  ];
  if (featurePrefixes.some((p) => path === p || path.startsWith(`${p}/`))) {
    return "/og/feature.png";
  }
  return "/og/home.png";
}

/**
 * Per-page metadata: title/description verbatim from the copy docs, canonical
 * URL, and OpenGraph/Twitter. OG images are supplied by file-based
 * opengraph-image routes per page-family, so images are intentionally omitted
 * here (Next merges the two).
 */
export function pageMetadata(input: PageMetaInput): Metadata {
  const { title, description, path, ogTitle, type = "website", noindex } = input;
  const url = absUrl(path);
  const ogImage = ogImageForPath(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: ogTitle ?? title,
      description,
      url,
      siteName: "SuperComment",
      type,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle ?? title,
      description,
      images: [ogImage],
    },
    ...(noindex
      ? { robots: { index: false, follow: false } }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* JSON-LD builders. Schema is hygiene, not a citation lever: emit once,      */
/* keep descriptions byte-identical to the canonical copy, validate, move on. */
/* ------------------------------------------------------------------ */

const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: "SuperComment",
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    description: DESC_25,
    sameAs: [
      "https://github.com/supercomment",
      "https://x.com/supercomment",
      "https://www.linkedin.com/company/supercomment",
    ],
  };
}

export function websiteLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: "SuperComment",
    url: SITE_URL,
    publisher: { "@id": ORG_ID },
  };
}

export function softwareApplicationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SuperComment",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description: DESC_25,
    offers: [
      { "@type": "Offer", name: "Solo", price: "7", priceCurrency: "USD" },
      { "@type": "Offer", name: "Team", price: "29", priceCurrency: "USD" },
      { "@type": "Offer", name: "Pro", price: "49", priceCurrency: "USD" },
    ],
  };
}

export type Crumb = { name: string; path: string };

export function breadcrumbLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absUrl(c.path),
    })),
  };
}

export type QA = { q: string; a: string };

export function faqPageLd(items: QA[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

export function webPageLd(input: {
  name: string;
  description: string;
  path: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.name,
    description: input.description,
    url: absUrl(input.path),
    isPartOf: { "@id": WEBSITE_ID },
  };
}

export function aboutPageLd(input: { description: string; path: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "About SuperComment",
    description: input.description,
    url: absUrl(input.path),
    about: { "@id": ORG_ID },
    isPartOf: { "@id": WEBSITE_ID },
  };
}

export function itemListLd(input: { name: string; items: Crumb[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: input.name,
    itemListElement: input.items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      url: absUrl(it.path),
    })),
  };
}

export function articleLd(input: {
  headline: string;
  datePublished: string;
  path: string;
  description?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    datePublished: input.datePublished,
    ...(input.description ? { description: input.description } : {}),
    url: absUrl(input.path),
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  };
}

export function definedTermLd(input: { term: string; definition: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: input.term,
    description: input.definition,
    inDefinedTermSet: `${SITE_URL}/#glossary`,
  };
}
