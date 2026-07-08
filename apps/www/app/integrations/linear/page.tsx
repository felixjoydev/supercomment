import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { IntegrationChild } from "@/components/site/IntegrationChild";

export const metadata: Metadata = pageMetadata({
  title: "Sync Website Feedback to Linear | SuperComment",
  description:
    "The Linear integration creates a task from a comment, carrying the capture summary and deploy context, and keeps status in sync across both.",
  path: "/integrations/linear",
});

export default function LinearIntegrationPage() {
  return (
    <IntegrationChild
      id="linear"
      name="Linear"
      liveTitle="Feedback becomes a task. The task keeps its deploy."
      liveAnswer="The Linear integration creates a task from a comment, carrying the capture summary and deploy context, and keeps status in sync: resolve in one place, reflected in the other."
    />
  );
}
