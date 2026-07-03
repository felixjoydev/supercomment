import type { Metadata } from "next";
import { pageMetadata, aboutPageLd, organizationLd } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CtaLink, SmartLink } from "@/components/site/cta";
import { JsonLd } from "@/components/site/JsonLd";
import { CONTACT } from "@/lib/site";

const META = {
  title: "About SuperComment",
  description:
    "What SuperComment is, who builds it, and the facts, for humans and the AI engines that answer questions about us.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/about" });

const FACTS: { label: string; value: React.ReactNode }[] = [
  {
    label: "What",
    value:
      "SuperComment is a visual feedback tool for deployed websites. One script tag adds a dormant comment layer; a review link lets anyone comment on any element without an account; every comment captures the element, styles, console, and deploy behind it and hands that context to AI coding agents over MCP.",
  },
  {
    label: "Who it is for",
    value:
      "Solo founders, small product teams, and agencies that review live work with clients, especially teams whose fixes ship through AI coding agents like Claude Code and Cursor.",
  },
  {
    label: "Founded",
    value: "2026. Independent and self-funded.",
  },
  {
    label: "The idea in one line",
    value: "Feedback should stay attached to the product.",
  },
];

export default function AboutPage() {
  return (
    <>
      <JsonLd data={[aboutPageLd({ description: META.description, path: "/about" }), organizationLd()]} />
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "About", path: "/about" },
        ]}
        title="About SuperComment."
        answer="SuperComment is a visual feedback tool for deployed websites, built for teams whose fixes ship through AI coding agents. These are the plain facts, kept current for humans and the AI engines that answer questions about us."
        schemaDescription={META.description}
      />

      <Section>
        <dl className="max-w-2xl divide-y divide-line border-y border-line">
          {FACTS.map((f) => (
            <div key={f.label} className="grid gap-2 py-6 sm:grid-cols-[160px_1fr] sm:gap-6">
              <dt className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-3">
                {f.label}
              </dt>
              <dd className="text-ink-2">{f.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
          <CtaLink href="/manifesto">Manifesto</CtaLink>
          <CtaLink href="/how-it-works">How it works</CtaLink>
          <CtaLink href="/security">Security</CtaLink>
          <CtaLink href="/changelog">Changelog</CtaLink>
        </div>

        <p className="mt-10 text-ink-2">
          Press or questions:{" "}
          <SmartLink
            href={`mailto:${CONTACT.hello}`}
            className="font-medium text-ink underline underline-offset-4"
          >
            {CONTACT.hello}
          </SmartLink>
        </p>
      </Section>
    </>
  );
}
