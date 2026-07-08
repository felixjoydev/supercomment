import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { IntegrationChild } from "@/components/site/IntegrationChild";

export const metadata: Metadata = pageMetadata({
  title: "Send Website Feedback to GitHub Issues | SuperComment",
  description:
    "Turn a SuperComment into a GitHub issue with the full capture summary, element, deploy, commit, and a deep link back to the live comment.",
  path: "/integrations/github",
});

export default function GithubIntegrationPage() {
  return (
    <IntegrationChild
      id="github"
      name="GitHub"
      liveTitle="Comments become issues. Context comes along."
      liveAnswer="The GitHub integration turns a SuperComment into a GitHub issue carrying the capture summary, with element, deploy, commit, and severity, plus a deep link back to the live comment. Triage in GitHub; fix with full context."
    >
      <div className="prose max-w-2xl">
        <ul>
          <li>Issue title from the comment note; body carries the capture summary and links.</li>
          <li>The deploy and commit ride along, so the issue names the build it happened on.</li>
          <li>Resolve in SuperComment when the fix ships; the issue links back for the paper trail.</li>
        </ul>
      </div>
    </IntegrationChild>
  );
}
