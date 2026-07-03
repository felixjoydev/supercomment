import type { Metadata } from "next";
import { pageMetadata, articleLd } from "@/lib/seo";
import { Container } from "@/components/site/primitives";
import { CtaButton } from "@/components/site/cta";
import { JsonLd } from "@/components/site/JsonLd";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "The SuperComment Manifesto | Feedback Should Stay Attached",
  description:
    "A precise observation became a sentence. Someone had to translate it back. We built SuperComment so the translation never happens.",
};

export const metadata: Metadata = pageMetadata({
  ...META,
  path: "/manifesto",
  type: "article",
});

const PROMISES = [
  "No accounts for your reviewers.",
  "No per-seat fees for feedback.",
  "No screenshots pasted into chat.",
  'No "cannot reproduce."',
  "No context lost in translation.",
];

export default function ManifestoPage() {
  return (
    <>
      <JsonLd
        data={articleLd({
          headline: "The SuperComment Manifesto",
          datePublished: "2026-07-01",
          path: "/manifesto",
          description: META.description,
        })}
      />
      <article className="py-20 md:py-28">
        <Container>
          <div className="mx-auto max-w-2xl">
            <h1 className="text-4xl md:text-5xl">
              Feedback should stay attached to the product.
            </h1>

            <div className="mt-10 space-y-6 text-lg leading-relaxed text-ink-2">
              <p>
                A reviewer sees exactly what is wrong. They are standing right in
                front of it. Then every tool asks them to leave, to a screenshot, a
                Slack thread, a ticket form, and describe from memory what was on
                the screen a moment ago.
              </p>
              <p>
                By the time it reaches whoever can fix it, the feedback has lost
                its element, its styles, its console, its deploy. A precise
                observation has become a sentence. And someone, or some agent, has
                to translate it back into the thing it started as.
              </p>
              <p>
                We built SuperComment so the translation never happens. The comment
                lives on the element it describes. It carries the context it was
                born with. When your coding agent picks it up, nothing is left to
                guess.
              </p>
            </div>

            <div className="mt-12">
              <p className="text-xl font-semibold text-ink">We promise:</p>
              <ul className="mt-5 space-y-2 text-lg text-ink-2">
                {PROMISES.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>

            <p className="mt-12 text-lg text-ink-2">
              What does a feedback tool look like when nothing is lost on the way?
            </p>

            <p className="mt-6 text-3xl font-semibold text-ink md:text-4xl">
              Point. Comment. Fixed.
            </p>

            <p className="mt-12 text-ink-3">Signed: the SuperComment team.</p>

            <div className="mt-8">
              <CtaButton href={START_FREE_URL}>Start free</CtaButton>
            </div>
          </div>
        </Container>
      </article>
    </>
  );
}
