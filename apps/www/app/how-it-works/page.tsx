import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CodeBlock, StepSection } from "@/components/site/bits";
import { CtaButton, CtaLink } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { START_FREE_URL, DOCS_URL } from "@/lib/site";

const META = {
  title: "How SuperComment Works | From Comment to Fix",
  description:
    "How SuperComment turns a click on your deployed site into model-ready context for your AI coding agent: embed, review link, comment, fix.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/how-it-works" });

const FAQ = [
  {
    q: "How long does setup take?",
    a: "One script tag plus registering your deploy URL: minutes, not an afternoon.",
  },
  {
    q: "Does it need a specific framework?",
    a: "No. Any site with a public https URL. React previews can add source stamping for file-and-line precision.",
  },
  {
    q: "Can visitors see it?",
    a: "No. Without a valid review link the overlay renders nothing.",
  },
  {
    q: "Where do comments go?",
    a: "Your dashboard, your agent over MCP, and, where enabled, GitHub, Slack, or Linear.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "How it works", path: "/how-it-works" },
        ]}
        title="How SuperComment works."
        answer="SuperComment adds a dormant comment layer to your deployed site through one script tag. A review link wakes it up for invited reviewers, who comment directly on the UI. Each comment captures twelve context signals and flows to your dashboard, and to your AI coding agent over MCP, which fixes and resolves it."
        schemaDescription={META.description}
      />

      <Section className="space-y-14 md:space-y-16">
        <StepSection n={1} title="Embed once.">
          <p>
            Add the script tag to your site&apos;s <code>&lt;head&gt;</code>. It
            ships as one async file, stays dormant for normal visitors, and
            renders nothing until a review link activates it.
          </p>
          <CodeBlock className="not-prose">
            {`<script src="https://app.supercomment.dev/sc-loader" async></script>`}
          </CodeBlock>
          <p>
            Any host with a public https URL works: Vercel, Netlify, Render,
            Railway, Fly, Cloudflare, your own infrastructure. Register the deploy
            URL in your dashboard and you are done.
          </p>
          <p>
            Production stays safe by default: on production deploys the loader is
            inert unless you explicitly opt in.
          </p>
        </StepSection>

        <StepSection n={2} title="Share a review link.">
          <p>
            Create a review link in the dashboard and send it to anyone:
            teammate, client, advisor. Opening it exchanges a single-use,
            90-second token for a review session on your real site.
          </p>
          <p>
            Reviewers never create an account. They pick a display name and start
            commenting. Your team members carry their roles; guests are clearly
            marked.
          </p>
        </StepSection>

        <StepSection n={3} title="Comment on the real thing.">
          <p>
            Click any element. The comment box opens against it: write the note,
            set intent (fix, change, question) and severity, attach a reference
            image, or switch to visual edits and make the change yourself.
          </p>
          <p>
            While the reviewer types, SuperComment captures the context: element
            and selector with stable anchors, computed styles, surrounding markup,
            console errors, network signals, accessibility chain, viewport,
            environment, state hints, interaction trail, and the deploy and commit
            being reviewed. Sensitive values are redacted before anything leaves
            the page.
          </p>
        </StepSection>

        <StepSection n={4} title="The fix comes back.">
          <p>
            Comments land in your dashboard, threaded by project and preview, with
            open, resolved, and dismissed states.
          </p>
          <p>
            Connect your coding agent over MCP and the loop closes: the agent
            lists open comments, reads the full capture, applies the change in
            your codebase, and resolves the comment. Permitted members can also
            push a comment straight to the agent. Route copies into GitHub, Slack,
            or Linear so the rest of the team stays in the loop.
          </p>
          <p className="text-ink">
            <strong>
              When builds carry context and comments carry intent, the fix does
              not need a meeting.
            </strong>
          </p>
        </StepSection>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
          <CtaLink href={DOCS_URL}>Read the quickstart</CtaLink>
        </div>
      </Section>
    </>
  );
}
