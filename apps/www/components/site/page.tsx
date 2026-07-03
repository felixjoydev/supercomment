import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Container, Eyebrow, DirectAnswer } from "./primitives";
import { Breadcrumbs } from "./Breadcrumbs";
import { CtaButton } from "./cta";
import { JsonLd } from "./JsonLd";
import { webPageLd, type Crumb } from "@/lib/seo";
import { START_FREE_URL } from "@/lib/site";

/**
 * Standard interior-page header: breadcrumb trail, one H1, and the 40-60 word
 * direct answer as a lead paragraph. WebPage schema is emitted here.
 */
export function PageHeader({
  crumbs,
  eyebrow,
  title,
  answer,
  schemaDescription,
}: {
  crumbs: Crumb[];
  eyebrow?: string;
  title: ReactNode;
  answer?: ReactNode;
  schemaDescription?: string;
}) {
  const current = crumbs[crumbs.length - 1];
  return (
    <section className="pt-9 md:pt-12">
      <Container>
        {schemaDescription && current ? (
          <JsonLd
            data={webPageLd({
              name: current.name,
              description: schemaDescription,
              path: current.path,
            })}
          />
        ) : null}
        <Breadcrumbs crumbs={crumbs} />
        {eyebrow ? <Eyebrow className="mt-6">{eyebrow}</Eyebrow> : null}
        <h1
          className={cn(
            "max-w-4xl text-4xl md:text-5xl",
            eyebrow ? "mt-4" : "mt-6",
          )}
        >
          {title}
        </h1>
        {answer ? <DirectAnswer>{answer}</DirectAnswer> : null}
      </Container>
    </section>
  );
}

/** A recurring CTA bar. Children are the buttons/links, rendered right-aligned. */
export function CtaBar({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-8 flex flex-wrap items-center gap-x-6 gap-y-3", className)}>
      {children ?? <CtaButton href={START_FREE_URL}>Start free</CtaButton>}
    </div>
  );
}
