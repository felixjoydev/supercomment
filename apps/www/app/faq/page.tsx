import type { Metadata } from "next";
import { pageMetadata, faqPageLd } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { FaqList } from "@/components/site/Faq";
import { JsonLd } from "@/components/site/JsonLd";
import { faqGroups, faqAll } from "@/lib/content/faq";

const META = {
  title: "SuperComment FAQ | Every Question, Answered Plainly",
  description:
    "What SuperComment is, how the review link works, what gets captured, which agents connect, what it costs: the full question bank.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/faq" });

export default function FaqPage() {
  return (
    <>
      <JsonLd data={faqPageLd(faqAll)} />
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ]}
        title="Questions, answered plainly."
        answer="Everything about SuperComment in one place: what it is, how the review link works, what each comment captures, which AI agents connect over MCP, and what it costs. Grouped so you can skim to the part you need."
        schemaDescription={META.description}
      />

      <Section className="space-y-12">
        {faqGroups.map((group) => (
          <div key={group.heading} className="max-w-3xl">
            <h2 className="text-xl">{group.heading}</h2>
            <div className="mt-4">
              <FaqList items={group.items} schema={false} />
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}
