import type { Metadata } from "next";
import { pageMetadata, softwareApplicationLd } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CtaButton, SmartLink } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { JsonLd } from "@/components/site/JsonLd";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment Pricing | Flat Plans, Unlimited Reviewers",
  description:
    "Free while in beta. Planned: Solo $7, Team $29, Pro $49. Flat monthly pricing with unlimited reviewers and review links on every plan. No per-seat fees for feedback.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/pricing" });

const TIERS = [
  {
    name: "Solo",
    price: "$7",
    blurb: "For one person shipping with an agent. Every feature, one project workspace, your whole loop.",
  },
  {
    name: "Team",
    price: "$29",
    blurb: "For small teams reviewing previews together. Workspaces, roles, and the agent permission controls.",
  },
  {
    name: "Pro",
    price: "$49",
    blurb: "For agencies and client workflows. Everything in Team, higher usage, priority integrations as they ship.",
  },
];

const INCLUDED = [
  "unlimited reviewers",
  "unlimited review links",
  "the full capture (all twelve signals)",
  "visual edits",
  "MCP agent handoff",
  "the dashboard",
  "redaction and security defaults",
];

const FAQ = [
  { q: "Is the beta really free?", a: "Yes. Full product, no card." },
  {
    q: "What happens to my data when pricing starts?",
    a: "Nothing. You pick a plan or export; we will announce timing well ahead.",
  },
  {
    q: "Is there a free plan after beta?",
    a: "Undecided. Beta users get first say and grandfathered consideration.",
  },
  {
    q: "Do you charge per reviewer or per seat?",
    a: "No. Reviewers are unlimited on every plan.",
  },
  { q: "Discounts?", a: "Open-source maintainers and students: write us." },
];

export default function PricingPage() {
  return (
    <>
      <JsonLd data={softwareApplicationLd()} />
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ]}
        eyebrow="Simple pricing"
        title="Flat pricing. Unlimited reviewers."
        answer="SuperComment is free while in beta. Planned pricing is flat: Solo $7/month, Team $29/month, Pro $49/month. Every plan includes unlimited reviewers and review links. Feedback-givers are never seats."
        schemaDescription={META.description}
      />

      <Section>
        <div className="sc-card-soft border-l-2 border-l-ink p-5">
          <p className="text-ink-2">
            <strong className="font-semibold text-ink">Beta banner.</strong>{" "}
            Everything is free while SuperComment is in beta. Plans below are the
            pricing we intend to launch with, locked before the beta ends, never
            mid-cycle.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.name} className="sc-card flex flex-col p-6">
              <h2 className="text-lg font-semibold text-ink">{t.name}</h2>
              <p className="mt-2 text-3xl font-semibold text-ink tnum">
                {t.price}
                <span className="text-base font-normal text-ink-3">/month</span>
              </p>
              <p className="mt-4 flex-1 text-ink-2">{t.blurb}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full bg-done-dot" />
                Free in beta
              </span>
              <div className="mt-5">
                <CtaButton href={START_FREE_URL} className="w-full">
                  Start free
                </CtaButton>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 sc-card-soft p-6">
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-3">
            Every plan includes
          </h3>
          <ul className="mt-4 flex flex-wrap gap-2">
            {INCLUDED.map((f) => (
              <li
                key={f}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink-2"
              >
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-ink">
            <strong className="font-semibold">The agent is not an upsell. It is the point.</strong>
          </p>
        </div>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Why flat?</h2>
        <p className="mt-4 max-w-2xl text-lg text-ink-2">
          Per-seat pricing punishes exactly the behavior a feedback tool should
          encourage: inviting more eyes. Charging you per client, per advisor, per
          teammate-who-glances means you stop inviting. We charge for the
          workspace, not the people helping you.{" "}
          <SmartLink href="/manifesto" className="font-medium text-ink underline underline-offset-4">
            It is in the manifesto.
          </SmartLink>
        </p>
      </Section>

      <Section>
        <h2 className="text-3xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-10">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
        </div>
      </Section>
    </>
  );
}
