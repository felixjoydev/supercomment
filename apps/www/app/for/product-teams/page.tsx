import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CtaButton, CtaLink } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment for Product Teams | UI Review on the Real Product",
  description:
    "PMs and designers comment on the deployed preview; developers and agents receive full context. Replace screenshot-and-describe with feedback attached to the product.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/for/product-teams" });

const FAQ = [
  {
    q: "Do reviewers on our team need seats?",
    a: "Members get accounts and roles; outside reviewers never need an account. Pricing is flat, not per seat.",
  },
  {
    q: "Does it replace Linear or Jira?",
    a: "No. It replaces the screenshot-and-describe step before them, and syncs to where your work lives.",
  },
  {
    q: "What about previews behind auth?",
    a: "If your team can open the URL and the review link, SuperComment works on it.",
  },
];

export default function ProductTeamsPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Product teams", path: "/for/product-teams" },
        ]}
        title="Feedback the whole team can act on."
        answer="SuperComment lets product teams review deployed previews on the page itself. PMs and designers comment on real elements; developers and AI agents receive the element, styles, console, and deploy, not a screenshot needing translation. Comments live in one dashboard with open, resolved, and dismissed states."
        schemaDescription={META.description}
      />

      <Section className="space-y-12">
        <div className="max-w-2xl">
          <h2 className="text-2xl">The standup tax.</h2>
          <p className="mt-3 text-ink-2">
            A designer spots a spacing issue. They screenshot it, crop it, post it
            in Slack, and describe where it lives. A developer reads it, asks which
            page, which viewport, which build. Two people, twenty minutes, zero
            code.
          </p>
          <p className="mt-3 text-ink-2">
            SuperComment removes the describing. The comment is already on the
            element, already carrying the viewport and the build.
          </p>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">Designers and PMs speak in the product.</h2>
          <div className="prose mt-3">
            <ul>
              <li>Comment with intent and severity: fix, change, question.</li>
              <li>
                Make the change with visual edits: exact values, per breakpoint,
                recorded as a before→after change-set.
              </li>
              <li>Attach the reference the team keeps asking for.</li>
            </ul>
          </div>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">Developers receive, not reconstruct.</h2>
          <p className="mt-3 text-ink-2">
            Selector, styles, console errors, network signals, deploy, commit.
            Attached. On stamped React previews, the component path, file, and
            line. Read it in the dashboard, or let the agent read it over MCP and
            open with a proposed fix.
          </p>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">Managed like real work.</h2>
          <p className="mt-3 text-ink-2">
            Workspaces, projects, roles. Open, resolved, dismissed. Who can send
            work to agents is a per-member permission your workspace owner
            controls. Route copies to GitHub, Slack, or Linear so nothing hides in
            a second inbox.
          </p>
        </div>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
          <CtaLink href="/visual-edits">Explore visual edits</CtaLink>
        </div>
      </Section>
    </>
  );
}
