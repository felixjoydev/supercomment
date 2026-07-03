import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CtaButton, CtaLink } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment for Solo Founders | Feedback Your Agent Fixes",
  description:
    "You are the PM, the reviewer, and the fix pipeline. SuperComment turns feedback on your deployed site into context your AI coding agent acts on: no tickets, no translation.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/for/solo-founders" });

const FAQ = [
  {
    q: "Is this overkill for one person?",
    a: "It replaces the note file, the screenshot folder, and the retyped prompt. One person is who feels that loss most.",
  },
  {
    q: "Can I use it on my own site without inviting anyone?",
    a: "Yes. Open your own review link and comment as you browse.",
  },
  {
    q: "Does it work with vibe-coded apps?",
    a: "If it deploys to a public https URL, it works, whatever wrote the code.",
  },
];

export default function SoloFoundersPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Solo founders", path: "/for/solo-founders" },
        ]}
        title="You ship with an agent. Your feedback should too."
        answer="SuperComment gives solo founders a feedback loop without a team: comment on your own deployed preview (or send a link to early users), and your AI coding agent receives the element, styles, console, and deploy behind every note, then fixes and resolves it. Flat $7/month planned; free while in beta."
        schemaDescription={META.description}
      />

      <Section className="space-y-12">
        <div className="max-w-2xl">
          <h2 className="text-2xl">The founder&apos;s real workflow.</h2>
          <p className="mt-3 text-ink-2">
            You review your own site at midnight. You notice six things. Today
            those six things become a note file, four screenshots, and a prompt
            you type from memory tomorrow.
          </p>
          <p className="mt-3 text-ink-2">
            With SuperComment: click, comment, done. Six times. In the morning,
            your agent lists six comments with full context, fixes them, resolves
            them.
          </p>
          <p className="mt-3 text-ink">
            <strong className="font-semibold">
              You are not writing tickets to yourself anymore.
            </strong>
          </p>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">Feedback from people who owe you nothing.</h2>
          <p className="mt-3 text-ink-2">
            Advisors, friends, first users: they will give you feedback if it
            costs them nothing. A review link costs them nothing: no account, no
            install, no instructions.
          </p>
          <p className="mt-3 text-ink-2">
            They point at the real site. You wake up to structured, actionable
            comments, not "the button looks weird on my phone" in a DM.
          </p>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">Built for the AI-native builder.</h2>
          <div className="prose mt-3">
            <ul>
              <li>Claude Code, Cursor, Codex: connect over MCP in one command.</li>
              <li>
                Every comment carries the deploy and commit, so the agent fixes
                against the build you reviewed, not today&apos;s drift.
              </li>
              <li>
                Visual edits let you set the exact value yourself. You know what
                16px means.
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">Honest pricing for one person.</h2>
          <p className="mt-3 text-ink-2">
            $7/month, flat, planned. Unlimited reviewers, because charging you per
            feedback-giver would be absurd. Free while in beta.
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
          <CtaLink href="/agent-handoff">See the agent handoff</CtaLink>
        </div>
      </Section>
    </>
  );
}
