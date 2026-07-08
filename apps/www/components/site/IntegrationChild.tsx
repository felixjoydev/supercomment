import type { ReactNode } from "react";
import { Section } from "./primitives";
import { PageHeader } from "./page";
import { CtaButton, CtaLink } from "./cta";
import { integrationStatus, START_FREE_URL, CONTACT } from "@/lib/site";

type Key = "github" | "slack" | "linear" | "jira";

/**
 * One template for every integration child page. It reads the single
 * integrationStatus constant: when live it renders the live copy, and when the
 * constant is flipped to "coming-soon" it renders the coming-soon template
 * instead, so any integration can be gated at launch in one line.
 */
export function IntegrationChild({
  id,
  name,
  liveTitle,
  liveAnswer,
  comingSoonNoun = "issue",
  children,
}: {
  id: Key;
  name: string;
  liveTitle: string;
  liveAnswer: string;
  comingSoonNoun?: string;
  children?: ReactNode;
}) {
  const status = integrationStatus[id];
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Integrations", path: "/integrations" },
    { name, path: `/integrations/${id}` },
  ];

  if (status === "coming-soon") {
    return (
      <>
        <PageHeader
          crumbs={crumbs}
          title={`${name} is coming.`}
          answer={`Comment → ${name} ${comingSoonNoun} with full capture context. Leave your email and we will tell you the day it ships.`}
        />
        <Section>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <CtaButton
              href={`mailto:${CONTACT.integrations}?subject=${encodeURIComponent(
                `${name} integration`,
              )}`}
            >
              Get notified
            </CtaButton>
            <CtaLink href="/integrations">Back to integrations</CtaLink>
          </div>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader crumbs={crumbs} title={liveTitle} answer={liveAnswer} />
      <Section>
        {children}
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
          <CtaLink href="/integrations">Back to integrations</CtaLink>
        </div>
      </Section>
    </>
  );
}
