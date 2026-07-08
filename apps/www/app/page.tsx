import type { Metadata } from "next";
import { SITE_VERSION } from "@/lib/site";
import { pageMetadata, softwareApplicationLd } from "@/lib/seo";
import { JsonLd } from "@/components/site/JsonLd";
import { HomeV1 } from "@/components/home/HomeV1";
import { HomeV2 } from "@/components/home/HomeV2";

/** Homepage metadata per variant, verbatim from the copy docs. */
export const HOME_META = {
  v1: {
    title: "SuperComment | Visual Feedback Your AI Agent Can Fix",
    description:
      "Comment on any element of your deployed site. No accounts, no installs. SuperComment hands your AI coding agent the full context to ship the fix.",
    ogTitle: "Visual feedback your AI agent can actually fix.",
  },
  v2: {
    title: "SuperComment | Agent-Ready Website Feedback",
    description:
      "Clients and teammates comment on your deployed site. Your AI coding agent gets 12 signals of context and ships the fix. No accounts, no translation.",
    ogTitle: "Agent-ready feedback.",
  },
} as const;

export const metadata: Metadata = pageMetadata({
  ...HOME_META[SITE_VERSION],
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <JsonLd data={softwareApplicationLd()} />
      {SITE_VERSION === "v1" ? <HomeV1 /> : <HomeV2 />}
    </>
  );
}
