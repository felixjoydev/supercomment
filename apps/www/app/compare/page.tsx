import type { Metadata } from "next";
import { pageMetadata, itemListLd } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { Check } from "@/components/site/bits";
import { CtaButton, CtaLink } from "@/components/site/cta";
import { JsonLd } from "@/components/site/JsonLd";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment vs BugHerd, Marker.io, Vercel Comments, Jam",
  description:
    "Honest comparisons. Where SuperComment wins, where the others do. Visual feedback tools for teams that ship with AI coding agents.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/compare" });

const CHILDREN = [
  { name: "vs BugHerd", path: "/compare/bugherd" },
  { name: "vs Marker.io", path: "/compare/marker-io" },
  { name: "vs Vercel Comments", path: "/compare/vercel-comments" },
  { name: "vs Jam", path: "/compare/jam" },
  { name: "vs Screenshots in Slack", path: "/compare/screenshots-in-slack" },
];

export default function ComparePage() {
  return (
    <>
      <JsonLd data={itemListLd({ name: "SuperComment comparisons", items: CHILDREN })} />
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
        ]}
        title="Compare us. We did."
        answer="SuperComment is a visual feedback layer built for AI-assisted teams: reviewers comment on the deployed site without accounts, and coding agents receive full context over MCP, then fix and resolve. Here is how that differs, honestly, from the tools you might be considering."
        schemaDescription={META.description}
      />

      <Section>
        <div className="table-wrap">
          <table className="sc-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th />
                <th>SuperComment</th>
                <th>BugHerd</th>
                <th>Marker.io</th>
                <th>Vercel Comments</th>
                <th>Jam</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Comment on live site, no reviewer account</td>
                <td><Check /></td>
                <td><Check /></td>
                <td>Guest-friendly</td>
                <td>Team members</td>
                <td>Reporter installs extension</td>
              </tr>
              <tr>
                <td>Visual edits as before→after change-sets</td>
                <td><Check /></td>
                <td>Text suggestions</td>
                <td>No</td>
                <td>No</td>
                <td>No</td>
              </tr>
              <tr>
                <td>Agent handoff over MCP</td>
                <td>Closed loop: read, fix, <strong>resolve</strong></td>
                <td>Read + manage (beta)</td>
                <td>Read</td>
                <td>No</td>
                <td>Read</td>
              </tr>
              <tr>
                <td>Deploy + commit attached to feedback</td>
                <td><Check /></td>
                <td>No</td>
                <td>No</td>
                <td>Preview-scoped</td>
                <td>No</td>
              </tr>
              <tr>
                <td>Accessibility chain captured</td>
                <td><Check /></td>
                <td>No</td>
                <td>No</td>
                <td>No</td>
                <td>No</td>
              </tr>
              <tr>
                <td>Works on any host</td>
                <td>Any public https URL</td>
                <td><Check /></td>
                <td><Check /></td>
                <td>Vercel only</td>
                <td>Anywhere (extension)</td>
              </tr>
              <tr>
                <td>Pricing model</td>
                <td>Flat, unlimited reviewers</td>
                <td>Seat bands from ~$42-50/mo</td>
                <td>Per seat from ~$39/mo</td>
                <td>Bundled with Vercel</td>
                <td>Per creator ~$16/mo</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-ink-3">
          Comparisons as of July 2026. Their sites are the source of truth for
          their pricing and features.
        </p>

        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
          {CHILDREN.map((c) => (
            <CtaLink key={c.path} href={c.path}>
              {c.name}
            </CtaLink>
          ))}
        </div>

        <div className="mt-10">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
        </div>
      </Section>
    </>
  );
}
