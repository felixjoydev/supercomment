import type { Metadata } from "next";
import { pageMetadata, softwareApplicationLd } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CodeBlock } from "@/components/site/bits";
import { CtaButton, CtaLink } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { JsonLd } from "@/components/site/JsonLd";
import { START_FREE_URL, DOCS_URL } from "@/lib/site";

const META = {
  title: "SuperComment MCP Server | Visual Feedback for Coding Agents",
  description:
    "The SuperComment MCP server exposes website feedback as structured context: list open comments, read full captures, resolve and dismiss, all from Claude Code, Cursor, or any MCP client.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/mcp" });

const TOOLS = [
  ["list_projects / use_project", "Discover and select the project to work in"],
  ["list_open_comments", "Open comments with a signals inventory per comment"],
  ["get_comment", "The full capture: element, styles, console, deploy, change-set"],
  ["get_all_open", "Everything open, curated for context windows"],
  ["resolve_comment", "Close the loop when the fix ships"],
  ["dismiss_comment", "Decline with a reason"],
];

const FAQ = [
  {
    q: "Is the MCP server included on every plan?",
    a: "Yes. The agent is not an upsell. It is the point.",
  },
  {
    q: "Can the agent see who wrote a comment?",
    a: "It sees a display name and whether the author is a member or guest.",
  },
  {
    q: "What stops prompt injection from a malicious reviewer?",
    a: "Reviewer text is redacted and explicitly labeled untrusted; your agent's harness decides what to do with it. Defense-in-depth, documented plainly.",
  },
];

export default function McpPage() {
  return (
    <>
      <JsonLd data={softwareApplicationLd()} />
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "MCP server", path: "/mcp" },
        ]}
        eyebrow="MCP server"
        title="The SuperComment MCP server."
        answer="SuperComment ships an MCP server that lets coding agents work with visual feedback from deployed sites. Seven tools cover the loop: list projects, select a project, list open comments, read a comment's full capture, resolve, and dismiss. Every payload carries structured context and labels reviewer text as untrusted input."
        schemaDescription={META.description}
      />

      <Section>
        <h2 className="text-3xl">Tools.</h2>
        <div className="mt-6 table-wrap max-w-3xl">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              {TOOLS.map(([tool, desc]) => (
                <tr key={tool}>
                  <td>
                    <code className="font-mono text-[13px]">{tool}</code>
                  </td>
                  <td>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Built for how agents actually read.</h2>
        <div className="prose mt-6 max-w-2xl">
          <ul>
            <li>
              List views curate bulky fields and attach a signals inventory;{" "}
              <code>get_comment</code> returns everything.
            </li>
            <li>
              Reviewer free-text is redacted and wrapped in an untrusted-input
              notice at the MCP boundary.
            </li>
            <li>Guest rasters are stripped from payloads; their existence is signaled.</li>
            <li>Change-sets arrive machine-structured and as plain language.</li>
          </ul>
        </div>
      </Section>

      <Section>
        <h2 className="text-3xl">Setup.</h2>
        <div className="mt-6 max-w-2xl">
          <CodeBlock>{`claude mcp add supercomment -- npx supercomment mcp`}</CodeBlock>
          <p className="mt-4 text-ink-2">
            Works with Claude Code, Cursor, Codex CLI, Windsurf, and any MCP
            client. <CtaLink href={DOCS_URL} className="align-baseline">Full setup guide</CtaLink>
          </p>
        </div>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaLink href={DOCS_URL}>Read the docs</CtaLink>
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
        </div>
      </Section>
    </>
  );
}
