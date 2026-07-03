/**
 * Changelog entries. Verb-first, specific nouns, one warm line per release.
 * The seed entry ships with the beta launch. `date` is the ISO publish date;
 * `label` is the human display (a quarter until the exact launch date is set).
 */
export type ChangelogEntry = {
  slug: string;
  title: string;
  date: string;
  label: string;
  bullets: string[];
};

export const changelog: ChangelogEntry[] = [
  {
    slug: "open-beta",
    title: "SuperComment enters open beta",
    date: "2026-07-01",
    label: "2026-Q3",
    bullets: [
      "One-script embed with dormant-by-default activation and single-use, 90-second review tokens.",
      "Comments with twelve captured signals, including deploy and commit provenance.",
      "Visual edits: text, style, spacing, and structural changes recorded as before→after change-sets.",
      "MCP server with seven tools: agents read full context, fix, and resolve.",
      "Workspaces, roles, and per-member send-to-agent permission, enforced server-side.",
      "Free while in beta. Point. Comment. Fixed.",
    ],
  },
];
