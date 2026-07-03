import { Section, Container, Eyebrow, StepNumber } from "@/components/site/primitives";
import { CtaButton, CtaLink, SmartLink } from "@/components/site/cta";
import { RichFaqList } from "@/components/site/Faq";
import { HeroVisual } from "@/components/brand/HeroVisual";
import { PayloadCard } from "@/components/brand/PayloadCard";
import { SignalGrid, type Signal } from "@/components/brand/SignalGrid";
import { ChangeSet } from "@/components/brand/ChangeSet";
import { IntegrationsList, TeamCard, PriceCard } from "./parts";
import { START_FREE_URL, DOCS_URL } from "@/lib/site";

const SIGNALS: Signal[] = [
  { title: "Element + selector.", body: "The exact node, with stable anchors that survive re-renders." },
  { title: "Computed styles.", body: "Twenty-four layout, type, and color properties as rendered." },
  { title: "Surrounding markup.", body: "The element in its real context, capped and redacted." },
  { title: "Console errors.", body: "The errors and warnings that fired before the comment." },
  { title: "Network signals.", body: "The requests the page made, with sensitive values stripped." },
  { title: "Accessibility chain.", body: "Roles and names up the tree: the page as assistive tech sees it." },
  { title: "Viewport + device.", body: "Size, pixel ratio, and the surface being reviewed." },
  { title: "Browser environment.", body: "Agent, language, platform." },
  { title: "State hints.", body: "Which storage keys exist, never their values." },
  { title: "Interaction trail.", body: "The clicks that led here, without input values." },
  { title: "Deploy + commit.", body: "The exact build the reviewer was looking at." },
  { title: "Visual capture.", body: "A picture of the element as the reviewer saw it." },
];

export function HomeV1() {
  return (
    <>
      {/* 1. Hero */}
      <Section className="pt-14 md:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <h1 className="text-4xl leading-[1.05] md:text-[3.25rem]">
              Visual feedback your AI agent can actually fix.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-ink-2 measure">
              SuperComment is a comment layer for your deployed site. Reviewers
              click any element and say what they mean. No accounts, no installs,
              no screenshots pasted into chat. Every comment carries the element,
              styles, console, and deploy behind it. Your coding agent gets
              everything.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <CtaButton href={START_FREE_URL}>Start free</CtaButton>
              <CtaButton href="/how-it-works" variant="secondary">
                See how it works
              </CtaButton>
            </div>
            <p className="mt-6 text-sm text-ink-3">
              One script tag. Works with Claude Code, Cursor, and any
              MCP-compatible agent. Free while in beta.
            </p>
          </div>
          <HeroVisual variant="v1" />
        </div>
      </Section>

      {/* 2. Manifesto strip */}
      <div className="border-y border-line bg-surface">
        <Container>
          <div className="flex flex-col items-start justify-between gap-3 py-7 sm:flex-row sm:items-center">
            <p className="text-lg font-medium text-ink">
              Feedback should stay attached to the product.
            </p>
            <CtaLink href="/manifesto">Read the manifesto</CtaLink>
          </div>
        </Container>
      </div>

      {/* 3. The problem */}
      <Section>
        <Eyebrow>The problem</Eyebrow>
        <h2 className="mt-4 max-w-3xl text-3xl md:text-4xl">
          Feedback loses its meaning the moment it leaves the page.
        </h2>
        <div className="mt-6 max-w-2xl space-y-4 text-lg text-ink-2">
          <p>
            A reviewer sees the exact problem. They are standing right in front
            of it. Then every tool asks them to leave, and describe it from
            memory.
          </p>
          <p>
            A screenshot in Slack. A ticket with no state. An email that says
            "make it cleaner."
          </p>
          <p>
            By the time it reaches whoever fixes it, the feedback has lost its
            element, its styles, its console, its deploy. A precise observation
            became a sentence. Now your agent gets to guess.
          </p>
          <p className="text-ink">
            <strong className="font-semibold">
              SuperComment keeps the comment attached to the thing it describes.
            </strong>
          </p>
        </div>
      </Section>

      {/* 4. How it works */}
      <Section className="border-t border-line bg-surface">
        <Eyebrow>The loop</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">Four steps. No translation.</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {[
            {
              n: 1,
              t: "Embed once.",
              b: "Add one script tag to your site. It loads async and stays dormant. Nothing renders, nothing binds, until a valid review link opens it.",
            },
            {
              n: 2,
              t: "Share a review link.",
              b: "Send it to a teammate, a client, an advisor. They open your real site and comment on the real UI. No account, ever.",
            },
            {
              n: 3,
              t: "Point and comment.",
              b: "Click any element. Write the note, set the intent, or make the edit yourself with visual edits. SuperComment captures the context automatically.",
            },
            {
              n: 4,
              t: "The agent ships the fix.",
              b: "Your coding agent reads the comment over MCP, with element, styles, console, and deploy, then applies the change, and resolves the comment.",
            },
          ].map((s) => (
            <div key={s.n} className="sc-card-soft flex gap-4 p-6">
              <StepNumber n={s.n} />
              <div>
                <h3 className="text-base font-semibold text-ink">{s.t}</h3>
                <p className="mt-1.5 text-ink-2">{s.b}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
          <span className="text-sm text-ink-2">
            Or read the{" "}
            <SmartLink href={DOCS_URL} className="font-medium text-ink underline underline-offset-4">
              two-minute quickstart
            </SmartLink>{" "}
            <span aria-hidden="true">→</span>
          </span>
        </div>
      </Section>

      {/* 5. What the agent sees */}
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_0.85fr] lg:items-start">
          <div>
            <Eyebrow>What the agent sees</Eyebrow>
            <h2 className="mt-4 text-3xl md:text-4xl">
              Twelve signals with every comment.
            </h2>
            <p className="mt-5 text-lg text-ink-2 measure">
              Screenshots make you guess. SuperComment hands your agent the page
              as data.
            </p>
            <SignalGrid items={SIGNALS} className="mt-8" />
            <p className="mt-8 text-ink-2 measure">
              On React previews with source stamping, comments also carry the
              component path and the exact file and line.
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
              Reviewers can edit the page directly: text, type, color, spacing,
              borders, structure, per breakpoint. SuperComment records every
              change as a structured before/after change-set.
            </p>
            <p className="mt-4 text-ink-2 measure">
              Not "make this section feel premium." Instead:
            </p>
          </div>
          <div>
            <ChangeSet
              rows={[
                { prop: "text", from: '"Get started"', to: '"Start free"' },
                { prop: "padding", from: "8px", to: "16px" },
                { prop: "color", from: "#666", to: "#0A0A0A" },
                { prop: "order", from: "hero.cta", to: "above the fold" },
              ]}
            />
            <p className="mt-6 text-ink">
              <strong className="font-semibold">The reviewer shows intent. The agent writes code.</strong>
            </p>
            <p className="mt-4 text-ink-2">
              Need to show rather than tell? Attach a reference image: "this is
              the look I want."
            </p>
            <div className="mt-6">
              <CtaLink href="/visual-edits">Explore visual edits</CtaLink>
            </div>
          </div>
        </div>
      </Section>

      {/* 7. Agent handoff */}
      <Section>
        <Eyebrow>Agent handoff</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">Your agent just became a teammate.</h2>
        <div className="mt-6 max-w-2xl space-y-4 text-lg text-ink-2">
          <p>
            Connect Claude Code, Cursor, or any MCP-compatible agent. It lists
            open comments, reads the full capture, applies the fix, and resolves
            the comment. A closed loop, not a copy-paste.
          </p>
          <p>
            You stay in control: sending work to agents is a per-member
            permission, enforced on the server. Guests can review; only the
            people you choose can dispatch.
          </p>
          <p>
            Everything a reviewer writes is labeled as untrusted input before
            your agent reads it.
          </p>
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
        <p className="mt-5 max-w-2xl text-lg text-ink-2">
          SuperComment is the source of truth for visual feedback. Route it
          wherever work happens next.
        </p>
        <IntegrationsList linear="synced tasks that stay attached to the deploy." />
        <div className="mt-8">
          <CtaLink href="/integrations">Explore integrations</CtaLink>
        </div>
      </Section>

      {/* 9. For every kind of team */}
      <Section>
        <Eyebrow>For every kind of team</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">One review layer. Three ways in.</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <TeamCard title="Solo founders." href="/for/solo-founders" cta="For solo founders">
            You are the PM, the reviewer, and the fix pipeline. Comment on your
            own preview; your agent handles the rest.
          </TeamCard>
          <TeamCard title="Product teams." href="/for/product-teams" cta="For product teams">
            PMs and designers give feedback the agent can act on. Developers stop
            translating.
          </TeamCard>
          <TeamCard title="Agencies." href="/for/agencies" cta="For agencies">
            Send clients a review link. They comment on the live site. No
            installs, no accounts, no training call.
          </TeamCard>
        </div>
      </Section>

      {/* 10. Works everywhere */}
      <Section className="border-t border-line bg-surface">
        <Eyebrow>Works everywhere</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">Your preview is enough.</h2>
        <div className="mt-6 max-w-2xl space-y-4 text-lg text-ink-2">
          <p>
            If it has a public URL, it works: Vercel, Netlify, Render, Railway,
            Fly, Cloudflare, your own box. Any framework. One script tag.
          </p>
          <p>
            No build integration required. React previews can add source stamping
            for file-and-line precision.
          </p>
        </div>
      </Section>

      {/* 11. Security */}
      <Section>
        <Eyebrow>Built for previews</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">Dormant by default. Careful by design.</h2>
        <div className="mt-8 max-w-2xl">
          <div className="prose">
            <ul>
              <li>
                The overlay renders nothing until a valid review link opens it,
                and review links are single-use, 90-second, server-minted tokens.
              </li>
              <li>
                Sensitive values are redacted at capture: form fields are masked
                in visual captures, secrets are stripped from text, storage
                values never leave the page.
              </li>
              <li>
                Guests can comment. Only permitted members can send work to
                agents. Server-enforced.
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8">
          <CtaLink href="/security">Read the security overview</CtaLink>
        </div>
      </Section>

      {/* 12. Pricing teaser */}
      <Section className="border-t border-line bg-surface">
        <Eyebrow>Simple pricing</Eyebrow>
        <h2 className="mt-4 text-3xl md:text-4xl">Flat pricing. Unlimited reviewers.</h2>
        <p className="mt-5 max-w-2xl text-lg text-ink-2">
          We do not charge for the people giving feedback. Every plan includes
          unlimited reviewers and review links.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <PriceCard name="Solo" price="$7">
            For solo founders shipping with an agent.
          </PriceCard>
          <PriceCard name="Team" price="$29">
            For small teams reviewing previews together.
          </PriceCard>
          <PriceCard name="Pro" price="$49">
            For agencies and teams with client workflows.
          </PriceCard>
        </div>
        <p className="mt-8 text-ink-2">
          <strong className="font-semibold text-ink">Free while in beta.</strong>{" "}
          Planned pricing, locked before launch.
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
            <h2 className="text-4xl md:text-6xl">Point. Comment. Fixed.</h2>
            <p className="mx-auto mt-6 max-w-xl text-lg text-ink-2">
              Feedback should stay attached to the product. Now it is.
            </p>
            <div className="mt-8 flex justify-center">
              <CtaButton href={START_FREE_URL}>Start free</CtaButton>
            </div>
            <p className="mt-5 text-sm text-ink-3">One script tag away.</p>
          </div>
        </Container>
      </div>
    </>
  );
}

const HOME_FAQ = [
  {
    q: "What is SuperComment?",
    text: "SuperComment is a visual feedback tool for deployed websites. Add one script tag, share a review link, and anyone can comment on any element. No account needed. Each comment captures the element, styles, console, and deploy, and hands that context to AI coding agents over MCP.",
    a: (
      <>
        SuperComment is a visual feedback tool for deployed websites. Add one
        script tag, share a review link, and anyone can comment on any element.
        No account needed. Each comment captures the element, styles, console,
        and deploy, and hands that context to AI coding agents over MCP.
      </>
    ),
  },
  {
    q: "Do reviewers need an account?",
    text: "No. A review link is enough. Reviewers comment as guests with a display name; your team controls the rest from the dashboard.",
    a: (
      <>
        No. A review link is enough. Reviewers comment as guests with a display
        name; your team controls the rest from the dashboard.
      </>
    ),
  },
  {
    q: "Will the script slow my site down?",
    text: "No. It loads async and stays dormant for normal visitors. It renders nothing and binds nothing until a valid review link activates it.",
    a: (
      <>
        No. It loads async and stays dormant for normal visitors. It renders
        nothing and binds nothing until a valid review link activates it.
      </>
    ),
  },
  {
    q: "Which AI agents work with SuperComment?",
    text: "Any MCP-compatible agent: Claude Code, Cursor, Codex CLI, Windsurf, and others. The agent lists open comments, reads full context, and resolves them when fixed.",
    a: (
      <>
        Any MCP-compatible agent: Claude Code, Cursor, Codex CLI, Windsurf, and
        others. The agent lists open comments, reads full context, and resolves
        them when fixed.
      </>
    ),
  },
  {
    q: "What data does a comment capture?",
    text: "Twelve signals: element and selector, computed styles, surrounding markup, console errors, network signals, accessibility chain, viewport, browser environment, storage keys (never values), interaction trail, deploy and commit, and a visual capture.",
    a: (
      <>
        Twelve signals: element and selector, computed styles, surrounding
        markup, console errors, network signals, accessibility chain, viewport,
        browser environment, storage keys (never values), interaction trail,
        deploy and commit, and a visual capture.
      </>
    ),
  },
  {
    q: "Does it work on production?",
    text: "It is designed for previews and staging. On production deploys the loader stays inert unless you explicitly opt in, and even then, nothing activates without a valid review link.",
    a: (
      <>
        It is designed for previews and staging. On production deploys the loader
        stays inert unless you explicitly opt in, and even then, nothing
        activates without a valid review link.
      </>
    ),
  },
  {
    q: "How is this different from BugHerd or Marker.io?",
    text: "Those tools collect feedback into a ticket board for humans. SuperComment structures feedback for the agent that fixes it: full capture, MCP handoff, closed loop.",
    a: (
      <>
        Those tools collect feedback into a ticket board for humans. SuperComment
        structures feedback for the agent that fixes it: full capture, MCP
        handoff, closed loop.{" "}
        <SmartLink href="/compare" className="font-medium text-ink underline underline-offset-4">
          See comparisons
        </SmartLink>{" "}
        <span aria-hidden="true">→</span>
      </>
    ),
  },
  {
    q: "What does it cost?",
    text: "Free while in beta. Planned: Solo $7, Team $29, Pro $49. Flat, with unlimited reviewers on every plan.",
    a: (
      <>
        Free while in beta. Planned: Solo $7, Team $29, Pro $49. Flat, with
        unlimited reviewers on every plan.
      </>
    ),
  },
];
