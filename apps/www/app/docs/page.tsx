import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CodeBlock } from "@/components/site/bits";
import { CtaLink } from "@/components/site/cta";

// The full docs site lands under /docs as a separate workstream. This is a
// placeholder so the nav link resolves; it is not indexed while it is a stub.
export const metadata: Metadata = pageMetadata({
  title: "Docs | SuperComment",
  description:
    "SuperComment documentation: quickstart, MCP setup, and the capture model. The full docs are being written.",
  path: "/docs",
  noindex: true,
});

export default function DocsPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Docs", path: "/docs" },
        ]}
        title="Docs."
        answer="The full documentation is being written. The essentials live here already: embed one script tag, register your deploy URL, and connect your agent over MCP."
      />

      <Section className="space-y-10">
        <div className="max-w-2xl">
          <h2 className="text-2xl">Quickstart</h2>
          <p className="mt-3 text-ink-2">
            Add the script tag to your site&apos;s head, then register your deploy
            URL in the dashboard.
          </p>
          <CodeBlock className="mt-4">
            {`<script src="https://app.supercomment.dev/sc-loader" async></script>`}
          </CodeBlock>
          <p className="mt-4">
            <CtaLink href="/how-it-works">See the full loop</CtaLink>
          </p>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">MCP setup</h2>
          <p className="mt-3 text-ink-2">
            Connect Claude Code, Cursor, or any MCP client in one command.
          </p>
          <CodeBlock className="mt-4">
            {`claude mcp add supercomment -- npx supercomment mcp`}
          </CodeBlock>
          <p className="mt-4">
            <CtaLink href="/mcp">MCP server reference</CtaLink>
          </p>
        </div>

        <div className="max-w-2xl">
          <h2 className="text-2xl">What gets captured</h2>
          <p className="mt-3 text-ink-2">
            Twelve signals per comment, with redaction at capture. The security
            overview describes the model in detail.
          </p>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            <CtaLink href="/agent-handoff">What the agent sees</CtaLink>
            <CtaLink href="/security">Security model</CtaLink>
          </p>
        </div>
      </Section>
    </>
  );
}
