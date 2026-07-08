import type { Metadata } from "next";
import { pageMetadata, itemListLd } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { StatusBadge } from "@/components/site/bits";
import { CtaLink, SmartLink } from "@/components/site/cta";
import { JsonLd } from "@/components/site/JsonLd";
import { integrationStatus, CONTACT } from "@/lib/site";

const META = {
  title: "SuperComment Integrations | Agents, GitHub, Slack, Linear",
  description:
    "Route visual feedback wherever work happens: AI coding agents over MCP today, plus GitHub, Slack, and Linear. Feedback in, work out.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/integrations" });

const CHILDREN = [
  { name: "GitHub", path: "/integrations/github" },
  { name: "Slack", path: "/integrations/slack" },
  { name: "Linear", path: "/integrations/linear" },
  { name: "Jira", path: "/integrations/jira" },
];

export default function IntegrationsPage() {
  return (
    <>
      <JsonLd
        data={itemListLd({ name: "SuperComment integrations", items: CHILDREN })}
      />
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Integrations", path: "/integrations" },
        ]}
        eyebrow="Integrations"
        title="Feedback in. Work out."
        answer="SuperComment is the source of truth for visual feedback on your deployed site. From there, feedback routes to where work happens: AI coding agents over MCP, GitHub issues, Slack channels, and Linear projects, each carrying the full capture, not a screenshot."
        schemaDescription={META.description}
      />

      <Section>
        <p className="max-w-2xl text-lg text-ink">
          <strong className="font-semibold">Agents are the first integration.</strong>{" "}
          Not a bolt-on: the reason SuperComment exists.
        </p>

        <div className="mt-8 table-wrap">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Integration</th>
                <th>Status</th>
                <th>What routes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>MCP agents (Claude Code, Cursor, …)</td>
                <td>
                  <StatusBadge status="live" />
                </td>
                <td>Full capture, closed loop: read, fix, resolve</td>
              </tr>
              <tr>
                <td>
                  <SmartLink href="/integrations/github" className="underline underline-offset-4">
                    GitHub
                  </SmartLink>
                </td>
                <td>
                  <StatusBadge status={integrationStatus.github} />
                </td>
                <td>Comment → issue with capture summary + deep link</td>
              </tr>
              <tr>
                <td>
                  <SmartLink href="/integrations/slack" className="underline underline-offset-4">
                    Slack
                  </SmartLink>
                </td>
                <td>
                  <StatusBadge status={integrationStatus.slack} />
                </td>
                <td>New-comment notifications with element context</td>
              </tr>
              <tr>
                <td>
                  <SmartLink href="/integrations/linear" className="underline underline-offset-4">
                    Linear
                  </SmartLink>
                </td>
                <td>
                  <StatusBadge status={integrationStatus.linear} />
                </td>
                <td>Comment → synced task, status flows back</td>
              </tr>
              <tr>
                <td>
                  <SmartLink href="/integrations/jira" className="underline underline-offset-4">
                    Jira
                  </SmartLink>
                </td>
                <td>
                  <StatusBadge status={integrationStatus.jira} />
                </td>
                <td>Comment → issue for teams that live in Jira</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-ink-2">
          Want one we have not built?{" "}
          <SmartLink
            href={`mailto:${CONTACT.integrations}`}
            className="font-medium text-ink underline underline-offset-4"
          >
            Tell us: {CONTACT.integrations}
          </SmartLink>
        </p>

        <div className="mt-8">
          <CtaLink href="/agent-handoff">See the agent handoff</CtaLink>
        </div>
      </Section>
    </>
  );
}
