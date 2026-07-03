import type { QA } from "@/lib/seo";
import { AGENT_READY_DEFINITION } from "@/lib/copy";

/**
 * The full 30-question FAQ bank (08-seo-aeo-geo.md section 6), grouped as
 * specified. Answers are 40-70 words, first sentence standalone. The two B2
 * questions are appended in both site versions per the build brief. The /faq
 * page is the superset; homepages embed their own smaller subset.
 */
export const faqGroups: { heading: string; items: QA[] }[] = [
  {
    heading: "Basics",
    items: [
      {
        q: "What is SuperComment?",
        a: "SuperComment is a comment layer for deployed websites. Reviewers click any element and comment, no accounts needed, and your AI coding agent gets everything it needs to ship the fix. Each comment's full context reaches agents like Claude Code over MCP, which fix and resolve it.",
      },
      {
        q: "What does SuperComment do?",
        a: "SuperComment turns visual feedback into fixes. You embed one script tag on your deployed site. You share a review link, and anyone comments directly on the UI without an account. Each comment captures the element, styles, console, and deploy, and your AI coding agent reads it over MCP, applies the change, and resolves it.",
      },
      {
        q: "Who is SuperComment for?",
        a: "SuperComment is for solo founders, product teams, and agencies. It fits anyone whose fixes ship through AI coding agents like Claude Code and Cursor: the reviewer points and comments on the real site, and the agent receives model-ready context to make the change. Reviewers never need an account.",
      },
      {
        q: "How do I install SuperComment?",
        a: "Add one script tag to your site's head, then register your deploy URL in the dashboard. That is the whole install. The loader stays dormant until a review link activates it, so normal visitors see nothing. Share a review link and reviewers can start commenting immediately.",
      },
      {
        q: "Which frameworks and hosts does it support?",
        a: "Any framework and any host with a public https URL: Vercel, Netlify, Render, Railway, Fly, Cloudflare, or your own infrastructure. There is no build integration to configure. React previews can add source stamping, which gives every comment the component path and the exact file and line.",
      },
      {
        q: "Does SuperComment slow my website down?",
        a: "No. The loader is a single async file that stays dormant for normal visitors. It renders nothing and binds nothing until a valid review link activates it, so there is no runtime cost on your production traffic.",
      },
      {
        q: "Does it work on production?",
        a: "SuperComment is designed for previews and staging. On production deploys the loader stays inert unless you explicitly opt in, and even then nothing activates without a valid review link. Most teams run it on staging and preview URLs.",
      },
    ],
  },
  {
    heading: "Reviewers",
    items: [
      {
        q: "Do reviewers need an account?",
        a: "No. A review link is enough. Reviewers pick a display name and start commenting as guests; your team members keep their roles and permissions. There is nothing for a reviewer to install or sign up for.",
      },
      {
        q: "Can clients leave feedback without logging in?",
        a: "Yes. That is the agency workflow: send a client a review link and they comment on the live staging site with no account, no install, and no training call. Their comments arrive with the element, page, viewport, and deploy attached.",
      },
      {
        q: "What does a reviewer see?",
        a: "A reviewer sees your live site with a comment layer on top. They click any element to leave a comment, set intent and severity, attach a reference image, or switch to visual edits and change the page directly. Everything happens on the real UI.",
      },
      {
        q: "Can reviewers edit the page?",
        a: "Yes. With visual edits, reviewers change text, type, color, spacing, borders, and structure, per breakpoint. Each change is recorded as a before/after change-set with exact values and never touches your deployed code. Your agent applies the real change in source.",
      },
      {
        q: "Can I attach a design reference?",
        a: "Yes. Attach a reference image to any comment to show the look you want. It rides along with the capture, so your agent sees the target directly instead of a description of it.",
      },
    ],
  },
  {
    heading: "Capture & privacy",
    items: [
      {
        q: "What data does a SuperComment capture?",
        a: "Twelve signals per comment: element and selector, computed styles, surrounding markup, console errors, network signals, accessibility chain, viewport and device, browser environment, state hints (storage keys, never values), interaction trail, deploy and commit, and a visual capture. On stamped React previews, the component path, file, and line as well.",
      },
      {
        q: "Does it capture what users type?",
        a: "No. Form values are masked in visual captures, input values are never recorded in the interaction trail, and storage values never leave the page, only their key names. SuperComment captures the page's structure and state, not what a person typed into it.",
      },
      {
        q: "How does redaction work?",
        a: "Redaction happens at capture, before anything leaves the page. Secret-shaped strings are stripped from text, form fields are masked in visual captures, storage values are dropped, and network query strings are removed. It is best-effort by design, layered on every path, and documented honestly.",
      },
      {
        q: "Is the screenshot a real screenshot?",
        a: "It is a visual capture rendered from the page's DOM: a faithful picture of the element for most pages. For anything it cannot reproduce exactly, reference images cover the gap. The capture travels with the comment so your agent sees what the reviewer saw.",
      },
      {
        q: "Where are captures stored?",
        a: "Visual captures live in a private storage bucket governed by row-level security and served to your team through short-lived signed URLs. Guest captures are withheld from agent payloads entirely; only their existence is signaled.",
      },
      {
        q: "Is SuperComment SOC 2 certified?",
        a: "Not yet. SuperComment is in open beta, and the security page states plainly what is and is not in place rather than implying otherwise. The current posture: dormant-by-default embed, single-use tokens, redaction at capture, row-level security, and server-enforced permissions.",
      },
    ],
  },
  {
    heading: "Agents & MCP",
    items: [
      {
        q: "Which AI agents work with SuperComment?",
        a: "Any MCP-compatible agent: Claude Code, Cursor, Codex CLI, Windsurf, and Zed. The agent lists open comments, reads each comment's full capture, applies the fix in your codebase, and resolves the comment when it ships.",
      },
      {
        q: "What is the SuperComment MCP server?",
        a: "The SuperComment MCP server exposes visual feedback to coding agents through seven tools: list projects, select a project, list open comments, read a comment's full capture, read everything open, resolve, and dismiss. Every payload carries structured context and labels reviewer text as untrusted input.",
      },
      {
        q: "How do I connect Claude Code to SuperComment?",
        a: "Run one command: claude mcp add supercomment, pointed at npx supercomment mcp. Link the project, and your agent can see open comments with full context. The same MCP server works with Cursor, Codex CLI, Windsurf, and any other MCP client.",
      },
      {
        q: "What context does the agent receive?",
        a: "The full capture: element and selector, computed styles, console errors, network signals, accessibility chain, deploy and commit, and more, plus the reviewer's note, intent, and severity, and any visual edits as a before/after change-set. Reviewer free-text is labeled untrusted input at the MCP boundary.",
      },
      {
        q: "Can the agent resolve comments?",
        a: "Yes. Resolve and dismiss are first-class MCP tools, permission-checked on the server. When the fix ships, the agent resolves the comment and your dashboard reflects it, closing the loop instead of leaving an open ticket behind.",
      },
      {
        q: "Who can send work to agents?",
        a: "Only members a workspace owner explicitly permits, and the check is enforced on the server for every request. Guests can comment but never dispatch to an agent. You decide who can turn a comment into work.",
      },
      {
        q: "How does SuperComment handle prompt injection?",
        a: "With defense in depth. Reviewer free-text is redacted and wrapped in an untrusted-input notice at the MCP boundary, so your agent's harness decides what to do with it. Guest media is withheld from payloads. The safeguards are documented plainly, not implied.",
      },
    ],
  },
  {
    heading: "Integrations & comparison",
    items: [
      {
        q: "Does SuperComment integrate with Slack, Linear, or GitHub?",
        a: "Yes. GitHub, Slack, and Linear are supported: a comment can become a GitHub issue, a Slack notification, or a synced Linear task, each carrying the full capture. Jira is coming soon. Every routed item links back to the live, element-anchored comment.",
      },
      {
        q: "How is SuperComment different from BugHerd or Marker.io?",
        a: "Those tools optimize a ticket for a human to read. SuperComment optimizes context for the agent that fixes it: twelve captured signals per comment, visual edits as machine-applicable change-sets, and a closed loop where the agent reads, fixes, and resolves. Pricing is flat, with unlimited reviewers.",
      },
      {
        q: "How is it different from Vercel Comments?",
        a: "Vercel Comments works for team members inside Vercel previews. SuperComment works on any host, welcomes reviewers without accounts, captures twelve context signals per comment, and closes the loop through AI coding agents over MCP: the agent story Vercel Comments does not have.",
      },
    ],
  },
  {
    heading: "Pricing",
    items: [
      {
        q: "How much does SuperComment cost?",
        a: "SuperComment is free while in beta. Planned pricing is flat: Solo $7, Team $29, and Pro $49 per month, each with unlimited reviewers and review links. Feedback-givers are never charged as seats.",
      },
      {
        q: "Do you charge per seat or per reviewer?",
        a: "No. There are no per-reviewer or per-seat fees, ever. Every plan includes unlimited reviewers and review links; you pay a flat price for the workspace, not for the people helping you.",
      },
    ],
  },
  {
    heading: "Agent-ready feedback",
    items: [
      {
        q: "What is agent-ready feedback?",
        a: AGENT_READY_DEFINITION,
      },
      {
        q: "What is a signal?",
        a: "One captured piece of context. SuperComment captures twelve per comment, from the element and its styles to the deploy and commit, so the agent fixes what the reviewer actually saw.",
      },
    ],
  },
];

/** Flattened, for a single FAQPage schema block covering the whole page. */
export const faqAll: QA[] = faqGroups.flatMap((g) => g.items);
