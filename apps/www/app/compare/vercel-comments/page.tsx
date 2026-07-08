import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { ChooseBlocks } from "@/components/site/compare";
import { CtaButton } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment vs Vercel Comments | Beyond the Preview Toolbar",
  description:
    "Vercel Comments is a solid team feature inside Vercel previews. SuperComment works on any host, invites clients without accounts, and hands your AI agent the fix context.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/compare/vercel-comments" });

const FAQ = [
  {
    q: "Can I run both?",
    a: "Yes. They do not conflict; many teams keep Comments for teammates and SuperComment for clients and agents.",
  },
  {
    q: "Does SuperComment work on Vercel previews?",
    a: "Yes. Register the preview URL pattern and go.",
  },
];

export default function CompareVercelCommentsPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: "vs Vercel Comments", path: "/compare/vercel-comments" },
        ]}
        title="SuperComment vs Vercel Comments."
        answer="Vercel Comments is a bundled feature of the Vercel Toolbar: teammates comment on preview deployments, with Slack sync. SuperComment is an independent feedback layer that works on any host, welcomes reviewers without accounts, captures twelve context signals per comment, and closes the loop through AI coding agents over MCP, the piece Vercel's own users keep asking for."
        schemaDescription={META.description}
      />

      <Section>
        <div className="max-w-2xl">
          <h2 className="text-2xl">Credit where due.</h2>
          <p className="mt-3 text-ink-2">
            If your whole team is on Vercel and reviewers are team members,
            Comments is right there, default-on for previews, with @mentions and
            Slack sync. Zero setup is hard to beat.
          </p>
        </div>

        <div className="mt-10 max-w-2xl">
          <h2 className="text-2xl">Where SuperComment differs.</h2>
          <div className="prose mt-4">
            <ul>
              <li>
                <strong>Any host.</strong> Vercel, Netlify, Render, Railway, Fly,
                Cloudflare, your own box: one script tag on any public https URL.
              </li>
              <li>
                <strong>Anyone can review.</strong> Clients and advisors comment
                through a review link: no Vercel account, no team invite.
              </li>
              <li>
                <strong>The agent loop exists.</strong> Vercel Comments has no agent
                story; requests for exactly that sit unanswered in their community
                forum. SuperComment was built as one: full capture over MCP, fix,
                resolve.
              </li>
              <li>
                <strong>Deeper capture.</strong> Comments carry console errors,
                network signals, a11y chain, computed styles, deploy and commit, not
                just a pin and a thread.
              </li>
            </ul>
          </div>
        </div>

        <ChooseBlocks
          theirName="Vercel Comments"
          theirReason="Everyone reviewing is on your Vercel team and a pin plus a thread covers your needs."
          ourReason="Reviewers include people outside your team, you deploy anywhere, or your fixes ship through a coding agent."
        />
      </Section>

      <Section className="border-t border-line bg-surface">
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
