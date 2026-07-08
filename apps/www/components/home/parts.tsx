import type { ReactNode } from "react";
import { CtaLink } from "@/components/site/cta";
import { StatusBadge } from "@/components/site/bits";
import { integrationStatus } from "@/lib/site";

export function IntegrationLine({
  name,
  badge,
  children,
}: {
  name: string;
  badge: "live" | "coming-soon";
  children: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <p className="text-ink-2">
        <strong className="font-semibold text-ink">{name}</strong>: {children}
      </p>
      <StatusBadge status={badge} />
    </li>
  );
}

/** The homepage integrations list. `linear` copy differs slightly by variant. */
export function IntegrationsList({ linear }: { linear: string }) {
  return (
    <ul className="mt-8 max-w-2xl divide-y divide-line border-y border-line">
      <IntegrationLine name="AI coding agents" badge="live">
        over MCP: first-class, today.
      </IntegrationLine>
      <IntegrationLine name="GitHub" badge={integrationStatus.github}>
        comments become issues with full context.
      </IntegrationLine>
      <IntegrationLine name="Slack" badge={integrationStatus.slack}>
        the thread hears about it, with a link back to the element.
      </IntegrationLine>
      <IntegrationLine name="Linear" badge={integrationStatus.linear}>
        {linear}
      </IntegrationLine>
      <IntegrationLine name="Jira" badge={integrationStatus.jira}>
        coming soon.
      </IntegrationLine>
    </ul>
  );
}

export function TeamCard({
  title,
  href,
  cta,
  children,
}: {
  title: string;
  href: string;
  cta: string;
  children: ReactNode;
}) {
  return (
    <div className="sc-card-soft flex flex-col p-6">
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 flex-1 text-ink-2">{children}</p>
      <div className="mt-5">
        <CtaLink href={href}>{cta}</CtaLink>
      </div>
    </div>
  );
}

export function PriceCard({
  name,
  price,
  children,
}: {
  name: string;
  price: string;
  children: ReactNode;
}) {
  return (
    <div className="sc-card flex flex-col p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-ink">{name}</h3>
        <p className="text-2xl font-semibold text-ink tnum">
          {price}
          <span className="text-sm font-normal text-ink-3">/mo</span>
        </p>
      </div>
      <p className="mt-3 text-ink-2">{children}</p>
    </div>
  );
}
