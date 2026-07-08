import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { ChooseBlocks } from "@/components/site/compare";
import { CtaButton } from "@/components/site/cta";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment vs Marker.io | Feedback for QA vs Feedback for Agents",
  description:
    "Marker.io excels at bug reporting into your existing PM tool. SuperComment structures visual feedback for AI coding agents. An honest comparison for 2026.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/compare/marker-io" });

export default function CompareMarkerIoPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: "vs Marker.io", path: "/compare/marker-io" },
        ]}
        title="SuperComment vs Marker.io."
        answer="Marker.io is a polished website feedback and bug-reporting tool that shines at piping annotated reports into Jira, Asana, and other PM tools, with session replay and a client-friendly guest portal. SuperComment optimizes a different pipeline: comment → model-ready context → AI coding agent → fix → resolve."
        schemaDescription={META.description}
      />

      <Section>
        <div className="max-w-2xl">
          <h2 className="text-2xl">Where Marker.io is strong.</h2>
          <p className="mt-3 text-ink-2">
            Two-way sync with the PM stack, session replay, data masking, a guest
            portal that hides your internal tool from clients, and vertical depth
            (QA/UAT flows). If your bottleneck is <em>reporting bugs into the
            tracker</em>, Marker.io is excellent.
          </p>
        </div>

        <div className="mt-10 max-w-2xl">
          <h2 className="text-2xl">Where SuperComment differs.</h2>
          <div className="prose mt-4">
            <ul>
              <li>
                <strong>Destination.</strong>{" "}Marker.io&apos;s endpoint is a
                well-formed ticket for a human. SuperComment&apos;s endpoint is a
                fix. The agent reads, applies, resolves.
              </li>
              <li>
                <strong>Capture for models, not just humans.</strong> Selector with
                stable anchors, computed styles, a11y chain, deploy and commit,
                fields chosen because agents need them.
              </li>
              <li>
                <strong>Reviewers can edit, not just annotate.</strong> Exact values
                per breakpoint, recorded as change-sets.
              </li>
              <li>
                <strong>Pricing.</strong> Marker.io starts around $39/month (3
                seats, annual) and scales per seat; agency plan $99-129/month (as of
                July 2026). SuperComment is planned flat at $7/$29/$49 with unlimited
                reviewers.
              </li>
            </ul>
          </div>
        </div>

        <ChooseBlocks
          theirName="Marker.io"
          theirReason="Your team's fixes flow through a human PM pipeline in Jira or Asana, and session replay is core to your QA."
          ourReason="Your fixes flow through an agent, and you would rather send it twelve structured signals than a ticket it has to parse."
        />

        <div className="mt-12">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
        </div>
      </Section>
    </>
  );
}
