import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";

export const metadata: Metadata = pageMetadata({
  title: "Terms of Service | SuperComment",
  description:
    "The terms that govern use of SuperComment. The full terms of service are being finalized ahead of general availability.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Terms", path: "/terms" },
        ]}
        title="Terms of service."
      />
      <Section>
        <div className="prose max-w-2xl">
          <p>
            <strong>Placeholder.</strong> This page is a placeholder. The final
            terms of service are being prepared and will replace this text before
            general availability.
          </p>
          <h2>What we intend to cover</h2>
          <ul>
            <li>Acceptable use of the comment layer and review links.</li>
            <li>Accounts, workspaces, and the responsibilities of each.</li>
            <li>Beta status, availability, and changes to the service.</li>
            <li>Billing terms once paid plans begin.</li>
            <li>Liability, warranties, and termination.</li>
          </ul>
        </div>
      </Section>
    </>
  );
}
