import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { IntegrationChild } from "@/components/site/IntegrationChild";

export const metadata: Metadata = pageMetadata({
  title: "Website Feedback in Slack | SuperComment",
  description:
    "The Slack integration posts new comments to a channel you choose, with note, element, page, severity, and a link back to the live comment.",
  path: "/integrations/slack",
});

export default function SlackIntegrationPage() {
  return (
    <IntegrationChild
      id="slack"
      name="Slack"
      liveTitle="The thread hears about it. The context stays attached."
      liveAnswer="The Slack integration posts new comments to a channel you choose: note, element, page, severity, and a link to the live comment. The conversation happens where your team talks; the context stays on the product."
    />
  );
}
