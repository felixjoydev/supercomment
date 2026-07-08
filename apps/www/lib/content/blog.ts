/**
 * The first ten planned posts (08-seo-aeo-geo.md section 7), as an unpublished
 * data structure. None are rendered as live posts yet; the blog index lists them
 * as planned so nothing fabricated ships. `status` flips to "published" per post
 * when the real article lands.
 */
export type BlogPost = {
  slug: string;
  title: string;
  target: string;
  status: "planned" | "published";
};

export const blogPosts: BlogPost[] = [
  {
    slug: "point-comment-fixed",
    title: "Point. Comment. Fixed. Introducing SuperComment.",
    target: "Brand launch",
    status: "planned",
  },
  {
    slug: "claude-code-visual-feedback",
    title: "How to give Claude Code visual feedback on a deployed site",
    target: "Claude Code feedback",
    status: "planned",
  },
  {
    slug: "screenshots-terrible-bug-reports",
    title: "Why screenshots make terrible bug reports",
    target: "Linkable opinion",
    status: "planned",
  },
  {
    slug: "context-agent-needs-ui-bugs",
    title: "The context an AI coding agent actually needs to fix UI bugs",
    target: "AI agent context",
    status: "planned",
  },
  {
    slug: "bugherd-alternatives-2026",
    title: "BugHerd alternatives in 2026, an honest list, us included",
    target: "BugHerd alternative",
    status: "planned",
  },
  {
    slug: "client-feedback-without-accounts",
    title: "Client feedback without client accounts: the agency playbook",
    target: "Agency workflow",
    status: "planned",
  },
  {
    slug: "mcp-servers-frontend-teams",
    title: "MCP servers for frontend teams: a practical guide",
    target: "MCP servers frontend",
    status: "planned",
  },
  {
    slug: "vercel-comments-missing-agent-loop",
    title: "Vercel Comments and the missing agent loop",
    target: "Vercel Comments feedback agent",
    status: "planned",
  },
  {
    slug: "make-it-pop-to-merged-pr",
    title: 'From "make it pop" to a merged PR',
    target: "Visual-intent story",
    status: "planned",
  },
  {
    slug: "no-per-seat-pricing",
    title: "We don't charge per seat. Here's why.",
    target: "Pricing manifesto",
    status: "planned",
  },
];
