import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy | SuperComment",
  description:
    "How SuperComment handles data. The full privacy policy is being finalized ahead of general availability.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Privacy", path: "/privacy" },
        ]}
        title="Privacy policy."
      />
      <Section>
        <div className="prose max-w-2xl">
          <p>
            <strong>Placeholder.</strong> This page is a placeholder. The final
            privacy policy is being prepared and will replace this text before
            general availability.
          </p>
          <h2>What we intend to cover</h2>
          <ul>
            <li>What data SuperComment collects, and why.</li>
            <li>How reviewer comments and captures are stored and retained.</li>
            <li>Redaction and the data that never leaves your page.</li>
            <li>Subprocessors and where data is hosted.</li>
            <li>Your rights, and how to exercise them.</li>
          </ul>
          <p>
            For questions in the meantime, the security overview describes how
            SuperComment treats your site and your data today.
          </p>
        </div>
      </Section>
    </>
  );
}
