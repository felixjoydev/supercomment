import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CtaButton } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "SuperComment vs Screenshots in Slack | An Honest Comparison",
  description:
    "The most popular feedback tool in the world is a screenshot in Slack. Free, instant, universal. And it loses everything your agent needs. A fair fight.",
};

export const metadata: Metadata = pageMetadata({
  ...META,
  path: "/compare/screenshots-in-slack",
});

const ROWS = [
  ["Setup", "None", "One script tag"],
  ["Shows the problem", "A flattened picture", "The element, live, in context"],
  ["Which build?", "Whenever that tab was open", "Deploy + commit attached"],
  ["Console, network, viewport", "Gone", "Captured"],
  ['"Where is that?"', "A follow-up thread", "Selector + anchors"],
  ["Agent-readable", "A picture to interpret", "Twelve structured signals"],
  ["Resolution tracking", "Scroll and hope", "Open → resolved, synced"],
  ["Price", "Free", "Free while in beta; flat after"],
];

const FAQ = [
  {
    q: "Is this really a comparison page?",
    a: "Yes. The screenshot is our largest competitor, and switching from it should be an informed decision.",
  },
  {
    q: "What if reviewers still send screenshots?",
    a: "Send them a review link back. The habit changes in about a day.",
  },
];

export default function CompareScreenshotsPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: "vs Screenshots in Slack", path: "/compare/screenshots-in-slack" },
        ]}
        title="SuperComment vs screenshots in Slack."
        answer="The screenshot-in-Slack workflow is free, instant, and universal. And it strips feedback of the element, styles, console, viewport, and deploy needed to fix it. SuperComment keeps the click-to-report speed and preserves all of it, machine-readably, for your team and your coding agent."
        schemaDescription={META.description}
      />

      <Section>
        <div className="max-w-2xl">
          <h2 className="text-2xl">In fairness to the screenshot.</h2>
          <p className="mt-3 text-ink-2">
            Zero setup. Zero learning curve. Works on anything with pixels. The
            screenshot is the incumbent because it deserves to be: for{" "}
            <em>showing</em>. It just cannot <em>tell</em>.
          </p>
        </div>

        <div className="mt-10 table-wrap max-w-3xl">
          <table className="sc-table">
            <thead>
              <tr>
                <th />
                <th>Screenshot in Slack</th>
                <th>SuperComment</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r[0]}>
                  <td>{r[0]}</td>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 max-w-2xl">
          <h2 className="text-2xl">The thread tax.</h2>
          <p className="mt-3 text-ink-2">
            Every screenshot spawns a thread: <em>which page? which browser? can
            you reproduce? is this the new build?</em> The context existed the
            moment the reviewer saw the problem. The screenshot just could not
            carry it. That thread is the cost, paid every time, forever.
          </p>
        </div>

        <div className="mt-10 max-w-2xl">
          <h2 className="text-2xl">Keep Slack. Lose the archaeology.</h2>
          <p className="mt-3 text-ink-2">
            SuperComment posts to Slack too. The difference is what arrives: a link
            to a live, element-anchored, deploy-stamped comment instead of{" "}
            <code>Screenshot 2026-07-03 at 4.12.11 PM.png</code>.
          </p>
        </div>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-10">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
        </div>
      </Section>
    </>
  );
}
