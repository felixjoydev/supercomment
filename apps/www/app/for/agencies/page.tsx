import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CtaButton, CtaLink } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment for Agencies | Client Feedback Without Accounts",
  description:
    "Send clients a review link. They comment on the live site: no logins, no installs, no training call. Your team and your AI agent receive precise, actionable feedback.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/for/agencies" });

const FAQ = [
  {
    q: "Do clients need to install anything?",
    a: "Nothing. The script is on your staging build; clients just open the link.",
  },
  {
    q: "Can clients see each other's comments?",
    a: "Reviewers on the same preview see its comments: one shared conversation on the real site.",
  },
  {
    q: "Can we control what clients trigger?",
    a: "Yes. Guests comment only; sending work to agents stays with the members you permit.",
  },
  {
    q: "Does it work on our white-label staging domains?",
    a: "Any public https URL you register.",
  },
];

export default function AgenciesPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Agencies", path: "/for/agencies" },
        ]}
        title="Clients see it. Now they can say it."
        answer="SuperComment lets agency clients give feedback directly on the live staging site through a review link: no account, no install, no PDF markups. Every client comment arrives with the element, page, viewport, and deploy attached, ready for your team or your AI coding agent to act on. Flat pricing, unlimited clients."
        schemaDescription={META.description}
      />

      <Section className="space-y-12">
        <div className="max-w-2xl">
          <h2 className="text-2xl">Round three of "make it cleaner."</h2>
          <p className="mt-3 text-ink-2">
            Client feedback dies in transit: an email thread, an annotated PDF, a
            call where someone says "the thing near the top." Your PM translates it
            into tickets. Your developer translates the ticket back into a guess.
          </p>
          <p className="mt-3 text-ink-2">
            A review link ends the translation. The client points at the thing
            near the top. The comment knows exactly what it is.
          </p>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">Zero-friction for clients. Genuinely zero.</h2>
          <div className="prose mt-3">
            <ul>
              <li>
                Open link → type a display name → comment. No signup, no install,
                no walkthrough call.
              </li>
              <li>
                They can even make the change, "this blue, not that blue," with
                visual edits, recorded as exact values.
              </li>
              <li>They see your real site, not a screenshot of last Tuesday&apos;s build.</li>
            </ul>
          </div>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">Your margin lives in the round-trips.</h2>
          <p className="mt-3 text-ink-2">
            Every clarification round costs an hour you did not quote. Comments
            that arrive with full context, and flow to your coding agent for the
            mechanical fixes, collapse revision rounds from days to hours.
          </p>
          <p className="mt-3 text-ink-2">
            Deploy-stamped comments end "that was fixed on Thursday" disputes:
            every comment names the build it was made on.
          </p>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">Flat pricing that respects client work.</h2>
          <p className="mt-3 text-ink-2">
            Unlimited reviewers and review links on every plan. Clients are never
            seats. Planned: Pro at $49/month, flat, while per-seat competitors
            charge you for every client who opens the site.
          </p>
        </div>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaButton href={START_FREE_URL}>Send your first review link</CtaButton>
          <CtaLink href="/pricing">See pricing</CtaLink>
        </div>
      </Section>
    </>
  );
}
