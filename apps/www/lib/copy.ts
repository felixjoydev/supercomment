/**
 * Canonical strings that must appear byte-identical wherever they are used.
 * Entity consistency is a real GEO lever: engines resolve "SuperComment" into
 * one thing faster when every surface says the same words. Do not paraphrase.
 */

/** 8 words: bio / tagline. */
export const DESC_8 = "Visual feedback your AI coding agent can fix.";

/** ~25 words: meta description / directory listing / SoftwareApplication schema. */
export const DESC_25 =
  "SuperComment is a comment layer for deployed websites. Reviewers click any element and comment, no accounts needed, and your AI coding agent gets everything it needs to ship the fix.";

/** ~60 words: About page / press / listings. */
export const DESC_60 =
  "SuperComment is a visual feedback tool for teams that build with AI. Add one script tag to a deployed site and anyone with a review link can click an element, leave a comment, or make a visual edit. No account required. Each comment captures the element, styles, console, and deploy behind it, and hands that context to AI coding agents like Claude Code over MCP.";

/**
 * The category definition. Byte-identical everywhere: homepage definition strip,
 * /faq, /agent-handoff opening, llms.txt, DefinedTerm schema. This is the GEO
 * asset; engines lift definitional passages.
 */
export const AGENT_READY_DEFINITION =
  "Agent-ready feedback is feedback that arrives carrying everything an AI coding agent needs to act on it: the exact element, its styles, the errors on the page, the build it happened on, and the reviewer's intent as structured data. SuperComment produces agent-ready feedback from any deployed website.";

/** The loop, in three beats. */
export const LOOP_MOTIF = "Point. Comment. Fixed.";

/** The twelve signals, in canonical order (B2 positioning section 3). */
export const SIGNAL_LABELS = [
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
] as const;

/**
 * A representative capture, for the payload card (the brand's signature image).
 * Monospace label/value rows: the page as data, not a screenshot.
 */
export const PAYLOAD_ROWS: { label: string; value: string }[] = [
  { label: "element", value: "button.cta--hero" },
  { label: "selector", value: "main > section:nth-of-type(1) > a.cta--hero" },
  { label: "styles", value: "font-size:14px  padding:8px 12px  color:#6b7280" },
  { label: "markup", value: "<a class=\"cta--hero\">Get started</a>" },
  { label: "console", value: "1 warning  hydration mismatch @ Hero.tsx" },
  { label: "network", value: "GET /api/session  304  (query stripped)" },
  { label: "a11y", value: "link → nav → banner  name: \"Get started\"" },
  { label: "viewport", value: "390 × 844  dpr 3  mobile" },
  { label: "environment", value: "Chrome 141  en-US  macOS" },
  { label: "state", value: "keys: sc_session, theme  (values withheld)" },
  { label: "trail", value: "click header.logo → scroll → click cta--hero" },
  { label: "deploy", value: "prod-8fa1  commit a4f21c  2026-07-03" },
];
