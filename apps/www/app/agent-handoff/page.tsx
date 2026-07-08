import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/site/primitives";
import { PageHeader } from "@/components/site/page";
import { CtaButton, CtaLink } from "@/components/site/cta";
import { FaqList } from "@/components/site/Faq";
import { PayloadCard } from "@/components/brand/PayloadCard";
import { START_FREE_URL } from "@/lib/site";

const META = {
  title: "Send Website Feedback to Your AI Coding Agent",
  description:
    "SuperComment gives Claude Code, Cursor, and any MCP-compatible agent the element, styles, console, and deploy behind every comment. Then the agent fixes and resolves it.",
};

export const metadata: Metadata = pageMetadata({ ...META, path: "/agent-handoff" });

const RECEIVES = [
  "element and selector with stable anchors",
  "computed styles",
  "surrounding markup",
  "console errors",
  "network signals",
  "accessibility chain",
  "viewport and environment",
  "state hints",
  "interaction trail",
  "deploy URL and commit",
  "visual capture",
  "reference images (members)",
  "the full change-set for visual edits",
  "the reviewer's note, intent, and severity",
];

const FAQ = [
  {
    q: "Which agents work?",
    a: "Any MCP-compatible agent: Claude Code, Cursor, Codex CLI, Windsurf, Zed.",
  },
  {
    q: "Does the agent act on its own?",
    a: "It acts when you run it. SuperComment supplies context and tools; your agent, your rules.",
  },
  {
    q: "Can the agent close comments?",
    a: "Yes. Resolve and dismiss are first-class tools, permission-checked server-side.",
  },
];

export default function AgentHandoffPage() {
  return (
    <>
      <PageHeader
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Agent handoff", path: "/agent-handoff" },
        ]}
        eyebrow="Agent handoff"
        title="Give your agent what screenshots never could."
        answer="SuperComment hands AI coding agents structured, model-ready context for every piece of visual feedback: the exact element, computed styles, console errors, deploy and commit, and any visual edits as a before→after change-set. Over MCP, with untrusted input labeled. The agent applies the fix and resolves the comment."
        schemaDescription={META.description}
      />

      <Section>
        <div className="max-w-2xl">
          <h2 className="text-3xl">
            The last mile of AI-assisted development is context.
          </h2>
          <p className="mt-4 text-lg text-ink-2">
            Your agent can write the fix in seconds, once it knows what, where,
            and against which build. A screenshot answers none of that. A
            SuperComment does.
          </p>
        </div>
      </Section>

      <Section className="border-t border-line bg-surface">
        <div className="grid gap-12 lg:grid-cols-[1fr_0.8fr] lg:items-start">
          <div>
            <h2 className="text-3xl">What the agent receives.</h2>
            <div className="mt-6 flex flex-wrap gap-2">
              {RECEIVES.map((r) => (
                <span
                  key={r}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 font-mono text-xs text-ink-2"
                >
                  {r}
                </span>
              ))}
            </div>
            <p className="mt-6 text-ink-2 measure">
              On source-stamped React previews: component path, file, and line.
            </p>
          </div>
          <PayloadCard />
        </div>
      </Section>

      <Section>
        <h2 className="text-3xl">A closed loop, not a copy-paste.</h2>
        <ol className="mt-6 max-w-2xl space-y-3">
          {[
            "Reviewer comments on the preview.",
            "Agent lists open comments over MCP.",
            "Agent reads the full capture and applies the change in your codebase.",
            "Agent resolves the comment. The dashboard reflects it.",
          ].map((step, i) => (
            <li key={step} className="flex gap-4">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-inset text-xs font-semibold text-ink tnum">
                {i + 1}
              </span>
              <span className="text-ink-2">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-ink">
          <strong className="font-semibold">
            Nothing is retyped, summarized, or lost on the way.
          </strong>
        </p>
      </Section>

      <Section className="border-t border-line bg-surface">
        <h2 className="text-3xl">Guardrails you control.</h2>
        <div className="prose mt-6 max-w-2xl">
          <ul>
            <li>
              <strong>Per-member permission.</strong> Sending work to agents is
              owner-granted and server-enforced. Guests can never dispatch.
            </li>
            <li>
              <strong>Untrusted by default.</strong> Every reviewer-written string
              is labeled untrusted input before your agent reads it.
            </li>
            <li>
              <strong>Guest media stays private.</strong> Guest visual captures are
              withheld from the agent payload; their existence is signaled instead.
            </li>
          </ul>
        </div>
      </Section>

      <Section>
        <h2 className="text-3xl">Questions, answered plainly.</h2>
        <div className="mt-8 max-w-3xl">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaButton href={START_FREE_URL}>Start free</CtaButton>
          <CtaLink href="/mcp">MCP server docs</CtaLink>
        </div>
      </Section>
    </>
  );
}
