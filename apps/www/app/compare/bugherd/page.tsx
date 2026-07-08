import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { ChooseBlocks } from "@/components/site/compare";
import { CtaButton } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment vs BugHerd | Which Feedback Tool in 2026?",
  description:
    "BugHerd is a mature visual feedback and bug-tracking tool for agencies. SuperComment is built for teams whose fixes ship through AI coding agents. An honest comparison.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/compare/bugherd" });

const FAQ = [
  {
    q: "Is SuperComment production-ready?",
    a: "Open beta: dormant-by-default embed, server-enforced permissions, and an honest security page.",
  },
  {
    q: "Can I migrate?",
    a: "Start fresh on your next preview; there is nothing to import. Comments live with deploys.",
  },
  {
    q: "Do you have a board?",
    a: "Yes, a light one built around the agent pipeline: Backlog, Agent Ready, Review, Done. The heavyweight workflow stays in your tracker or your agent; we sync to it.",
  },
];

export default function CompareBugherdPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: "vs BugHerd", path: "/compare/bugherd" },
        ]}
        title="SuperComment vs BugHerd."
        answer="BugHerd is a mature point-and-click feedback tool with kanban task management, strong agency adoption, and an MCP beta that lets agents read and manage tasks. SuperComment is younger and narrower on purpose: it structures every comment for the coding agent that fixes it. Full capture, deploy and commit provenance, visual edits as change-sets, and a closed resolve loop."
        schemaDescription={META.description}
      />

      <Section>
        <div className="max-w-2xl">
          <h2 className="text-2xl">Where BugHerd is strong.</h2>
          <p className="mt-3 text-ink-2">
            Twelve years of product. A built-in kanban board, deep agency
            workflows, unlimited guests on every tier, and an MCP surface with a
            broad tool set for triaging and managing tasks. If your team lives in
            BugHerd&apos;s board, it is a genuinely good home.
          </p>
        </div>

        <div className="mt-10 max-w-2xl">
          <h2 className="text-2xl">Where SuperComment differs.</h2>
          <div className="prose mt-4">
            <ul>
              <li>
                <strong>The loop closes in code.</strong>{" "}BugHerd&apos;s MCP lets an
                agent work the board. SuperComment&apos;s agent reads the full
                capture, applies the fix in source, and resolves the comment. The
                board is not the destination; the fix is.
              </li>
              <li>
                <strong>Deeper capture.</strong> Deploy URL and commit on every
                comment; accessibility chain; console, network signals, interaction
                trail; component path on React previews. Feedback names the build it
                happened on.
              </li>
              <li>
                <strong>Visual edits are values, not notes.</strong> Reviewers change
                text, color, spacing, structure, recorded as exact before→after
                change-sets an agent can apply.
              </li>
              <li>
                <strong>Flat pricing.</strong>{" "}BugHerd starts at ~$50/month for five
                seats, +$8 per extra seat (as of July 2026). SuperComment&apos;s
                planned pricing is flat: $7 solo, $29 team, $49 pro, with unlimited
                reviewers.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 table-wrap max-w-3xl">
          <table className="sc-table">
            <thead>
              <tr>
                <th />
                <th>SuperComment</th>
                <th>BugHerd</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Reviewer experience</td>
                <td>Review link, no account</td>
                <td>Point-and-click, guests free</td>
              </tr>
              <tr>
                <td>Task management</td>
                <td>Agent-pipeline board: Backlog, Agent Ready, Review, Done</td>
                <td>Full kanban board</td>
              </tr>
              <tr>
                <td>Agent integration</td>
                <td>MCP, closed loop incl. resolve</td>
                <td>MCP beta, read/triage/manage</td>
              </tr>
              <tr>
                <td>Capture</td>
                <td>12 signals incl. deploy+commit, a11y</td>
                <td>Screenshot + technical details</td>
              </tr>
              <tr>
                <td>Visual edits</td>
                <td>Structured change-sets</td>
                <td>Text suggestions</td>
              </tr>
              <tr>
                <td>Entry price (Jul 2026)</td>
                <td>$7-49/mo flat, planned; free beta</td>
                <td>~$42-50/mo, seat bands</td>
              </tr>
            </tbody>
          </table>
        </div>

        <ChooseBlocks
          theirName="BugHerd"
          theirReason="You want a proven, board-centric feedback workflow with a decade of polish, and your fixes flow through humans working a kanban."
          ourReason="Your fixes ship through Claude Code, Cursor, or another agent, and you want feedback born with the context the agent needs, at a flat price."
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
