import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { HomeV1 } from "@/components/home/HomeV1";

export const metadata: Metadata = pageMetadata({
  title: "Homepage V1 (preview) | SuperComment",
  description:
    "Side-by-side preview of homepage variant V1. Not indexed.",
  path: "/preview/home-v1",
  noindex: true,
});

export default function PreviewHomeV1() {
  return <HomeV1 />;
}
