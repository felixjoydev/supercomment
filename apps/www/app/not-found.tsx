import type { Metadata } from "next";
import { Container } from "@/components/site/primitives";
import { CtaButton } from "@/components/site/cta";
import { DOCS_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Not found | SuperComment",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <Container>
      <div className="flex flex-col items-center py-28 text-center md:py-36">
        <h1 className="text-4xl md:text-5xl">This element has no anchor.</h1>
        <p className="mt-6 max-w-lg text-lg text-ink-2">
          The page you are pointing at does not exist, which is exactly the kind
          of thing we would want a comment on.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <CtaButton href="/">Back to the homepage</CtaButton>
          <CtaButton href={DOCS_URL} variant="secondary">
            Read the docs
          </CtaButton>
        </div>
      </div>
    </Container>
  );
}
