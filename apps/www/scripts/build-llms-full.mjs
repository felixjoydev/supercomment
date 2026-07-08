// Generates public/llms-full.txt at build time: a single concatenated,
// docs-style corpus of the site's canonical content, for a developer's agent to
// read on request. Runs from `prebuild`.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");

const SIGNALS = [
  "element + selector",
  "computed styles",
  "surrounding markup",
  "console errors",
  "network signals",
  "accessibility chain",
  "viewport + device",
  "browser environment",
  "state hints",
  "interaction trail",
  "deploy + commit",
  "visual capture",
];

const doc = `# SuperComment

SuperComment is a comment layer for deployed websites. Reviewers click any element and comment, no accounts needed, and your AI coding agent gets everything it needs to ship the fix.

Tagline: Visual feedback your AI coding agent can fix.
The loop: Point. Comment. Fixed.

## What it is

SuperComment is a visual feedback tool for teams that build with AI. Add one script tag to a deployed site and anyone with a review link can click an element, leave a comment, or make a visual edit. No account required. Each comment captures the element, styles, console, and deploy behind it, and hands that context to AI coding agents like Claude Code over MCP.

## Agent-ready feedback

Agent-ready feedback is feedback that arrives carrying everything an AI coding agent needs to act on it: the exact element, its styles, the errors on the page, the build it happened on, and the reviewer's intent as structured data. SuperComment produces agent-ready feedback from any deployed website.

## How it works

1. Embed once. Add one async script tag to your site's head. It stays dormant for normal visitors and renders nothing until a valid review link activates it. Register your deploy URL in the dashboard.
2. Share a review link. Send it to a teammate, client, or advisor. Opening it exchanges a single-use, 90-second token for a review session on your real site. Reviewers never create an account.
3. Point and comment. Click any element. Write the note, set intent and severity, attach a reference image, or make the change with visual edits. Context is captured automatically and sensitive values are redacted before anything leaves the page.
4. The agent ships the fix. Your coding agent reads the comment over MCP with full context, applies the change in source, and resolves the comment.

## The twelve signals

Every comment carries twelve signals of context. A signal is one captured piece of context. Competitors send about four.

${SIGNALS.map((s, i) => `${i + 1}. ${s}`).join("\n")}

On source-stamped React previews, comments also carry the component path, file, and line.

## Visual edits

Reviewers can change the page directly: text, type, color, spacing, borders, and structure, per breakpoint. SuperComment records each change as a structured before/after change-set with exact values and stable element anchors, so an agent can apply the real fix in source. Edits preview locally and never touch deployed code.

## Agent handoff and MCP

SuperComment ships an MCP server with seven tools: list projects, select a project, list open comments, read a comment's full capture, read everything open, resolve, and dismiss. Reviewer free-text is redacted and labeled untrusted input at the MCP boundary. Sending work to agents is a per-member, server-enforced permission; guests can comment but never dispatch. Works with Claude Code, Cursor, Codex CLI, Windsurf, Zed, and any MCP client.

Setup: claude mcp add supercomment -- npx supercomment mcp

## Integrations

AI coding agents over MCP are the first integration. GitHub (comment to issue), Slack (notifications with element context), and Linear (synced tasks that keep their deploy) route feedback with the full capture. Jira is coming soon.

## Security

Dormant by default: without a valid review link the overlay renders nothing, binds nothing, and captures nothing. Review tokens are single-use, server-minted, and expire in 90 seconds. Redaction happens at capture. Row-level security governs every table; visual captures live in a private bucket served through short-lived signed URLs. Open beta, no SOC 2 yet, stated plainly.

## Pricing

Free while in beta. Planned flat pricing: Solo $7, Team $29, Pro $49 per month. Every plan includes unlimited reviewers and review links. Feedback-givers are never seats.

## How it compares

Tools like BugHerd, Marker.io, Vercel Comments, and Jam collect feedback into a ticket board or bug report for a human. SuperComment structures every comment for the coding agent that fixes it: twelve captured signals, deploy and commit provenance, the accessibility chain, visual edits as machine-applicable change-sets, and a closed loop where the agent reads, fixes, and resolves.

## Manifesto

Feedback should stay attached to the product. A reviewer sees exactly what is wrong. They are standing right in front of it. Then every tool asks them to leave, to a screenshot, a Slack thread, a ticket form, and describe from memory what was on the screen a moment ago. By the time it reaches whoever can fix it, the feedback has lost its element, its styles, its console, its deploy. A precise observation has become a sentence. We built SuperComment so the translation never happens.

## Links
- Home: https://supercomment.dev
- How it works: https://supercomment.dev/how-it-works
- Agent handoff: https://supercomment.dev/agent-handoff
- MCP server: https://supercomment.dev/mcp
- Visual edits: https://supercomment.dev/visual-edits
- Integrations: https://supercomment.dev/integrations
- Security: https://supercomment.dev/security
- Pricing: https://supercomment.dev/pricing
- Compare: https://supercomment.dev/compare
- FAQ: https://supercomment.dev/faq
- Manifesto: https://supercomment.dev/manifesto
`;

mkdirSync(pub, { recursive: true });
writeFileSync(join(pub, "llms-full.txt"), doc);
console.log("[llms] wrote public/llms-full.txt");
