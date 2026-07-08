import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { HomeV2 } from "@/components/home/HomeV2";

export const metadata: Metadata = pageMetadata({
  title: "Homepage V2 (preview) | SuperComment",
  description:
    "Side-by-side preview of homepage variant V2. Not indexed.",
  path: "/preview/home-v2",
  noindex: true,
});

export default function PreviewHomeV2() {
  return <HomeV2 />;
}
