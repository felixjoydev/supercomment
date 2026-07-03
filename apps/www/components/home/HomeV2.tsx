import { Section, Container, Eyebrow } from "@/components/site/primitives";
import { CtaButton, CtaLink, SmartLink } from "@/components/site/cta";
import { RichFaqList } from "@/components/site/Faq";
import { JsonLd } from "@/components/site/JsonLd";
import { HeroVisual } from "@/components/brand/HeroVisual";
import { PayloadCard } from "@/components/brand/PayloadCard";
import { PipelineBoard } from "@/components/brand/PipelineBoard";
import { SignalGrid, type Signal } from "@/components/brand/SignalGrid";
import { ChangeSet } from "@/components/brand/ChangeSet";
import { IntegrationsList, TeamCard, PriceCard } from "./parts";
import { definedTermLd } from "@/lib/seo";
import { AGENT_READY_DEFINITION } from "@/lib/copy";
import { START_FREE_URL, DOCS_URL } from "@/lib/site";

const SIGNALS: Signal[] = [
  { title: "Element + selector.", body: "The exact node, with anchors that survive re-renders." },
  { title: "Computed styles.", body: "Twenty-four layout, type, and color properties as rendered." },
  { title: "Surrounding markup.", body: "The element in context, capped and redacted." },
  { title: "Console errors.", body: "What fired before the comment." },
  { title: "Network signals.", body: "The requests the page made, sensitive values stripped." },
  { title: "Accessibility chain.", body: "The page as assistive tech sees it." },
  { title: "Viewport + device.", body: "Size, pixel ratio, surface." },
  { title: "Browser environment.", body: "Agent, language, platform." },
  { title: "State hints.", body: "Which storage keys exist. Never their values." },
  { title: "Interaction trail.", body: "The clicks that led here. No input values." },
  { title: "Deploy + commit.", body: "The exact build under review." },
  { title: "Visual capture.", body: "A picture of what the reviewer saw." },
];

const LOOP_STEPS = [
  { n: "1", t: "Embed once.", b: "One script tag. Dormant until a review link opens it; invisible to normal visitors." },
  { n: "2", t: "Share a review link.", b: "Clients and teammates open your real site. No accounts, ever." },
  { n: "3", t: "They point and comment.", b: "Or make the change themselves with visual edits. Context is captured automatically." },
  { n: "4", t: "Your agent ships the fix.", b: "It reads the comment over MCP with full context, applies the change in source, and resolves the comment." },
];

export function HomeV2() {
  return (
    <>
      <JsonLd
        data={definedTermLd({
          term: "Agent-ready feedback",
          definition: AGENT_READY_DEFINITION,
        })}
      />

      {/* 1. Hero */}
      <Section className="pt-14 md:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <h1 className="text-5xl leading-[1.02] md:text-[4rem]">
              Agent-ready feedback.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-ink-2 measure">
              Your team and your clients comment on the deployed site. Your coding
              agent receives the comment with 12 signals of context: the element,
              its styles, the errors on the page, the exact build it happened on.
              Then it ships the fix.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <CtaButton href={START_FREE_URL}>Start free</CtaButton>
              <CtaButton href="/how-it-works" variant="secondary">
                See the loop
              </CtaButton>
            </div>
            <p className="mt-6 text-sm text-ink-3">
              One script tag. No reviewer accounts. Works with Claude Code,
              Cursor, and any MCP agent. Free while in beta.
            </p>
          </div>
          <HeroVisual variant="v2" />
        </div>
      </Section>

      {/* 2. Definition strip */}
      <div className="border-y border-line bg-surface">
        <Container>
          <div className="py-10">
            <p className="max-w-4xl text-lg leading-relaxed text-ink-2">
              <strong className="font-semibold text-ink">
                Agent-ready feedback
              </strong>{" "}
              is feedback that arrives carrying everything an AI coding agent
              needs to act on it: the exact element, its styles, the errors on the
              page, the build it happened on, and the reviewer&apos;s intent as
              structured data. SuperComment produces agent-ready feedback from any
              deployed website.
            </p>
          </div>
        </Container>
      </div>

      {/* 3. The problem */}
      <Section>
        <Eyebrow>The problem</Eyebrow>
        <h2 className="mt-4 max-w-3xl text-3xl md:text-4xl">
          Your agent can fix anything it understands. So help it understand.
        </h2>
        <div className="mt-6 max-w-2xl space-y-4 text-lg text-ink-2">
          <p>
            A client sees the exact problem. A PM is standing right in front of
            it. Then every tool asks them to describe it from memory: a screenshot
            in Slack, a ticket with no state, an email that says "make it
            cleaner."
          </p>
          <p>
            A precise observation became a sentence. Someone pastes the sentence
            into a prompt. The agent guesses. The redeploy misses. Round two
            begins.
          </p>
          <p className="text-ink">
            <strong className="font-semibold">
              SuperComment keeps the comment attached to the thing it describes,
              and hands the agent the rest.
            </strong>
          </p>
        </div>
      </Section>

      {/* 4. The loop */}
      <Section className="border-t border-line bg-surface">
        <Eyebrow>The loop</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">Point. Comment. Fixed.</h2>
        <div className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2">
          {LOOP_STEPS.map((s) => (
            <div key={s.n} className="flex gap-4">
              <span className="mt-0.5 font-mono text-sm text-ink-3 tnum">
                {s.n}
              </span>
              <p className="text-ink-2">
                <strong className="font-semibold text-ink">{s.t}</strong> {s.b}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-lg font-medium text-ink">
          Feedback tonight. Deployed by morning.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
          <CtaLink href={DOCS_URL}>Two-minute quickstart</CtaLink>
        </div>
      </Section>

      {/* 5. The 12 signals */}
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_0.85fr] lg:items-start">
          <div>
            <Eyebrow>What the agent sees</Eyebrow>
            <h2 className="mt-4 text-3xl md:text-4xl">
              Every comment carries 12 signals.
            </h2>
            <p className="mt-5 text-lg text-ink-2 measure">
              A signal is one captured piece of context. Competitors send about
              four. SuperComment sends the page as data.
            </p>
            <SignalGrid items={SIGNALS} className="mt-8" />
            <p className="mt-8 text-ink-2 measure">
              On source-stamped React previews, add the component path, file, and
              line.
            </p>
            <p className="mt-6 text-lg font-semibold text-ink">
              Less guessing. Fewer round-trips. Cleaner fixes.
            </p>
          </div>
          <div className="lg:sticky lg:top-24">
            <PayloadCard />
          </div>
        </div>
      </Section>

      {/* 6. Visual edits */}
      <Section className="border-t border-line bg-surface">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Eyebrow>Visual edits</Eyebrow>
            <h2 className="mt-4 text-3xl md:text-4xl">
              Sometimes the best feedback is the change itself.
            </h2>
            <p className="mt-5 text-lg text-ink-2 measure">
              Reviewers edit the page directly: text, color, spacing, structure,
              per breakpoint. SuperComment records it as a before/after change-set
              with exact values. The reviewer shows intent; the agent writes code.
            </p>
            <div className="mt-6">
              <CtaLink href="/visual-edits">Explore visual edits</CtaLink>
            </div>
          </div>
          <ChangeSet
            rows={[
              { prop: "text", from: '"Get started"', to: '"Start free"' },
              { prop: "padding", from: "8px", to: "16px" },
              { prop: "color", from: "#666", to: "#0A0A0A" },
            ]}
          />
        </div>
      </Section>

      {/* 7. Triage, then dispatch */}
      <Section>
        <Eyebrow>Agent Ready</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">
          Not every comment becomes code. You decide which do.
        </h2>
        <div className="mt-6 max-w-2xl space-y-4 text-lg text-ink-2">
          <p>
            Feedback is a request, not an order. Comments land in Backlog; your
            team declines some with a reply, and drags the rest to{" "}
            <strong className="font-semibold text-ink">Agent Ready</strong>.
            Dispatching to the agent is a per-member permission, enforced on the
            server; clients can comment, never command.
          </p>
          <p>
            The agent fixes, resolves, and the card moves to Review. You verify on
            the next deploy. Done.
          </p>
        </div>
        <div className="mt-10">
          <PipelineBoard
            cards={[
              { stage: "backlog", selector: "footer.links", note: "Broken link on About" },
              { stage: "backlog", selector: "section.faq", note: "Reword the pricing answer" },
              { stage: "agent", selector: "button.cta--hero", note: "Gets lost on mobile" },
              { stage: "agent", selector: "nav.header", note: "Logo spacing is tight" },
              { stage: "review", selector: "section.pricing", note: "Copy: Start free" },
              { stage: "done", selector: "h1.hero", note: "Balance the headline" },
            ]}
          />
        </div>
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
          <CtaLink href="/agent-handoff">See the agent handoff</CtaLink>
          <CtaLink href="/mcp">MCP server docs</CtaLink>
        </div>
      </Section>

      {/* 8. Integrations */}
      <Section className="border-t border-line bg-surface">
        <Eyebrow>Integrations</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">Feedback in. Work out.</h2>
        <IntegrationsList linear="synced tasks that keep their deploy." />
        <div className="mt-8">
          <CtaLink href="/integrations">Explore integrations</CtaLink>
        </div>
      </Section>

      {/* 9. Who it is for */}
      <Section>
        <Eyebrow>For the people around the builder</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">
          Built for teams whose fixes ship through agents.
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <TeamCard title="Product teams." href="/for/product-teams" cta="For product teams">
            PMs and designers comment on the real preview; the agent does the
            mechanical fixes; developers review code instead of translating
            screenshots. The standup tax, gone.
          </TeamCard>
          <TeamCard title="Agencies." href="/for/agencies" cta="For agencies">
            Clients comment through a review link with zero setup. You triage on
            the board; the agent clears the punch list. Revision rounds in hours,
            and the margin stays yours.
          </TeamCard>
          <TeamCard title="Solo builders." href="/for/solo-founders" cta="For solo founders">
            You are the whole team. Comment on your own preview at midnight; wake
            up to fixes, not tickets. $7 flat.
          </TeamCard>
        </div>
      </Section>

      {/* 10. Works everywhere */}
      <Section className="border-t border-line bg-surface">
        <Eyebrow>Works everywhere</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">Your preview is enough.</h2>
        <p className="mt-6 max-w-2xl text-lg text-ink-2">
          Vercel, Netlify, Render, Railway, Fly, Cloudflare, your own box: any
          public https URL, any framework, one script tag.
        </p>
      </Section>

      {/* 11. Security */}
      <Section>
        <Eyebrow>Built for previews</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">
          Dormant by default. Careful by design.
        </h2>
        <p className="mt-6 max-w-2xl text-lg text-ink-2">
          Renders nothing without a valid review link; links are single-use,
          90-second, server-minted tokens. Sensitive values are redacted at
          capture. Guests comment; only permitted members dispatch to agents.
        </p>
        <div className="mt-8">
          <CtaLink href="/security">Read the security overview</CtaLink>
        </div>
      </Section>

      {/* 12. Pricing teaser */}
      <Section className="border-t border-line bg-surface">
        <Eyebrow>Simple pricing</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">Flat pricing. Unlimited reviewers.</h2>
        <p className="mt-5 max-w-2xl text-lg text-ink-2">
          We do not charge for the people giving feedback.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <PriceCard name="Solo" price="$7">
            For one person and their agent.
          </PriceCard>
          <PriceCard name="Team" price="$29">
            For teams reviewing previews together.
          </PriceCard>
          <PriceCard name="Pro" price="$49">
            For agencies and client workflows.
          </PriceCard>
        </div>
        <p className="mt-8 text-ink-2">
          <strong className="font-semibold text-ink">Free while in beta.</strong>
        </p>
        <div className="mt-6">
          <CtaLink href="/pricing">See pricing</CtaLink>
        </div>
      </Section>

      {/* 13. FAQ */}
      <Section>
        <h2 className="text-3xl md:text-4xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <RichFaqList items={HOME_FAQ} />
        </div>
      </Section>

      {/* 14. Close */}
      <div className="border-t border-line">
        <Container>
          <div className="py-24 text-center">
            <h2 className="text-4xl md:text-6xl">Comments become commits.</h2>
            <p className="mx-auto mt-6 max-w-xl text-lg text-ink-2">
              Feedback should stay attached to the product. Now it is.
            </p>
            <div className="mt-8 flex justify-center">
              <CtaButton href={START_FREE_URL}>Start free</CtaButton>
            </div>
            <p className="mt-5 text-sm text-ink-3">Point. Comment. Fixed.</p>
          </div>
        </Container>
      </div>
    </>
  );
}

const HOME_FAQ = [
  {
    q: "What is agent-ready feedback?",
    text: AGENT_READY_DEFINITION,
    a: (
      <>
        Agent-ready feedback is feedback that arrives carrying everything an AI
        coding agent needs to act on it: the exact element, its styles, the
        errors on the page, the build it happened on, and the reviewer&apos;s
        intent as structured data. SuperComment produces agent-ready feedback
        from any deployed website.
      </>
    ),
  },
  {
    q: 'What is a "signal"?',
    text: "One captured piece of context. SuperComment captures twelve per comment, from the element and its styles to the deploy and commit, so the agent fixes what the reviewer actually saw.",
    a: (
      <>
        One captured piece of context. SuperComment captures twelve per comment,
        from the element and its styles to the deploy and commit, so the agent
        fixes what the reviewer actually saw.
      </>
    ),
  },
  {
    q: "Do reviewers need an account?",
    text: "No. A review link is enough.",
    a: <>No. A review link is enough.</>,
  },
  {
    q: "Does every comment go to the agent?",
    text: "No. Your team triages; dispatch is a per-member, server-enforced permission. Clients can comment, never command.",
    a: (
      <>
        No. Your team triages; dispatch is a per-member, server-enforced
        permission. Clients can comment, never command.
      </>
    ),
  },
  {
    q: "Which agents work with it?",
    text: "Claude Code, Cursor, Codex CLI, Windsurf, Zed: any MCP client.",
    a: <>Claude Code, Cursor, Codex CLI, Windsurf, Zed: any MCP client.</>,
  },
  {
    q: "Will it slow my site down?",
    text: "No. Async, dormant, renders nothing without a valid review link.",
    a: <>No. Async, dormant, renders nothing without a valid review link.</>,
  },
  {
    q: "How is this different from BugHerd or Marker.io?",
    text: "They collect feedback into ticket boards for humans. SuperComment produces agent-ready feedback: 12 signals, structured change-sets, a closed fix-and-resolve loop.",
    a: (
      <>
        They collect feedback into ticket boards for humans. SuperComment produces
        agent-ready feedback: 12 signals, structured change-sets, a closed
        fix-and-resolve loop.{" "}
        <SmartLink href="/compare" className="font-medium text-ink underline underline-offset-4">
          Compare
        </SmartLink>{" "}
        <span aria-hidden="true">→</span>
      </>
    ),
  },
  {
    q: "What does it cost?",
    text: "Free in beta. Planned: Solo $7, Team $29, Pro $49, flat, unlimited reviewers.",
    a: (
      <>
        Free in beta. Planned: Solo $7, Team $29, Pro $49, flat, unlimited
        reviewers.
      </>
    ),
  },
];
