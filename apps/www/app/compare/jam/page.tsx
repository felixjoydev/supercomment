import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { ChooseBlocks } from "@/components/site/compare";
import { CtaButton } from "@/components/site/cta";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment vs Jam | Bug Capture vs Review Layer",
  description:
    "Jam is a superb one-click bug reporter for developers. SuperComment is a review layer on your deployed site for the whole team, and the agent that fixes it.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/compare/jam" });

export default function CompareJamPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: "vs Jam", path: "/compare/jam" },
        ]}
        title="SuperComment vs Jam."
        answer="Jam is a browser extension for one-click bug reports: screen recording, console, network. Beloved by developers and support teams. SuperComment approaches from the other side: a comment layer embedded in your site, where clients and teammates review the UI without installing anything, and agents receive structured fix context."
        schemaDescription={META.description}
      />

      <Section>
        <div className="max-w-2xl">
          <h2 className="text-2xl">Where Jam is strong.</h2>
          <p className="mt-3 text-ink-2">
            Best-in-class capture ergonomics for the <em>reporter</em>: instant
            replays, console and network logs, device details, an AI debugger, and
            an MCP server. For support tickets and dev-to-dev bug reports, Jam is
            excellent.
          </p>
        </div>

        <div className="mt-10 max-w-2xl">
          <h2 className="text-2xl">Where SuperComment differs.</h2>
          <div className="prose mt-4">
            <ul>
              <li>
                <strong>Nothing to install for reviewers.</strong>{" "}Jam&apos;s
                reporter installs an extension. SuperComment&apos;s reviewer opens a
                link, which is the difference between teammates filing bugs and{" "}
                <em>clients giving feedback</em>.
              </li>
              <li>
                <strong>Element-anchored review, not incident capture.</strong>{" "}
                Comments live on the element, with intent and severity: design
                feedback and copy changes, not only bugs.
              </li>
              <li>
                <strong>Visual edits.</strong> "Change this to 16px" as a recorded
                change-set is not a bug report, and Jam does not try to be that.
              </li>
              <li>
                <strong>Deploy-aware.</strong> Every comment names the deploy and
                commit it was made on.
              </li>
            </ul>
          </div>
        </div>

        <ChooseBlocks
          theirName="Jam"
          theirReason="You need rich bug reports from people who will install a dev tool: support teams, QA, developers."
          ourReason="You need feedback from people who will not install anything, and an agent-ready loop from comment to fix."
        />

        <div className="mt-12">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
        </div>
      </Section>
    </>
  );
}
