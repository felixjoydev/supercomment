import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { IntegrationChild } from "@/components/site/IntegrationChild";

export const metadata: Metadata = pageMetadata({
  title: "Jira Integration | Coming Soon | SuperComment",
  description:
    "A Jira integration is on the way: comment becomes a Jira issue with full capture context. Leave your email and we will tell you the day it ships.",
  path: "/integrations/jira",
});

export default function JiraIntegrationPage() {
  return (
    <IntegrationChild
      id="jira"
      name="Jira"
      comingSoonNoun="issue"
      // Live copy is unused while status is coming-soon, but kept ready for the flip.
      liveTitle="Feedback becomes a Jira issue. The issue keeps its deploy."
      liveAnswer="The Jira integration creates an issue from a comment, carrying the capture summary and deploy context, ready for teams that live in Jira."
    />
  );
}
