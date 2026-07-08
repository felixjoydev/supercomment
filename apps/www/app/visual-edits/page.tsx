import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CtaButton, CtaLink } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { ChangeSet } from "@/components/brand/ChangeSet";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "Visual Edits | Feedback as a Before→After Change-Set",
  description:
    "Reviewers edit the page directly: text, color, spacing, structure. SuperComment records a structured before→after change-set your AI agent can apply.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/visual-edits" });

const FAQ = [
  {
    q: "Do visual edits change my site?",
    a: "No. They preview locally in the reviewer's browser; the durable record is the change-set your agent applies in source.",
  },
  {
    q: "Can guests use visual edits?",
    a: "Yes. Guests can edit and comment; uploads are rate- and size-guarded.",
  },
  {
    q: "What if the reviewer's edit is wrong?",
    a: "It is feedback, not a deploy. Your agent applies it in code, your review process approves it, your next build ships it.",
  },
];

export default function VisualEditsPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Visual edits", path: "/visual-edits" },
        ]}
        eyebrow="Visual edits"
        title="Sometimes the best feedback is the change itself."
        answer="Visual edits let any reviewer change the page they are reviewing without writing code: text, typography, color, spacing, borders, structure. SuperComment records each change as a structured before→after change-set with exact values and stable element anchors, so an AI coding agent can apply the real fix in source."
        schemaDescription={META.description}
      />

      <Section>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-3xl">Words are lossy. Values are not.</h2>
            <p className="mt-4 text-lg text-ink-2 measure">
              "Make it bigger" forces a guess. A change-set does not:
            </p>
            <p className="mt-6 text-ink">
              <strong className="font-semibold">
                The reviewer shows intent. The agent writes code.
              </strong>
            </p>
          </div>
          <ChangeSet
            rows={[
              { prop: "fontSize", from: "16px", to: "20px" },
              { prop: "padding", from: "8px 12px", to: "16px 24px" },
              { prop: "text", from: '"Submit"', to: '"Start free"' },
              { prop: "move", from: ".pricing-cta", to: "before .testimonials" },
            ]}
          />
        </div>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">What reviewers can do.</h2>
        <div className="prose mt-6 max-w-2xl">
          <ul>
            <li>
              <strong>Text.</strong> Double-click and retype, inline.
            </li>
            <li>
              <strong>Type &amp; color.</strong> Family, size, weight; text and
              background color, with the nearest design token recorded alongside
              the raw value.
            </li>
            <li>
              <strong>Effects &amp; spacing.</strong> Shadows, corners, borders;
              padding and margin.
            </li>
            <li>
              <strong>Structure.</strong> Reorder sections, hide or remove
              elements, swap media, add a button or block. Recorded as intent with
              a precise insertion point.
            </li>
            <li>
              <strong>Per breakpoint.</strong> Edits can differ for mobile and
              desktop; a device toolbar previews each.
            </li>
          </ul>
          <p>
            Edits preview live in the reviewer&apos;s browser and never touch your
            deployed code. The change-set is the record, your agent makes the real
            change in source.
          </p>
        </div>
      </Section>

      <Section>
        <h2 className="text-3xl">Show, don&apos;t describe.</h2>
        <p className="mt-4 max-w-2xl text-lg text-ink-2">
          Attach a reference image to any comment: "this is the look I want." It
          rides along with the capture, so the agent sees the target, not a
          description of it.
        </p>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
          <CtaLink href="/agent-handoff">See what the agent receives</CtaLink>
        </div>
      </Section>
    </>
  );
}
