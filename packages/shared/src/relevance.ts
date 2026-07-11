import type {
  CapturedContext,
  ChangeOp,
  EditTarget,
  InsertionPoint,
} from "./schema.js";

/**
 * Relevance curation for the agent-facing comment payload.
 *
 * Capture is intentionally complete (the overlay records everything; the
 * dashboard and `get_comment` expose all of it). But flooding the coding agent
 * with every signal on every comment dilutes the decisive facts. This module
 * curates the context for the *triage* surfaces (`list_open_comments` /
 * `get_all_open`) so what we send is RELEVANT to the comment — while never
 * starving the agent:
 *
 *   1. the decisive, compact core is ALWAYS kept (selector, anchors, url,
 *      source location, screenshot, commit, bounding box, surrounding HTML),
 *   2. bulky runtime enrichment (network, interaction trail, app state,
 *      environment, computed styles, a11y tree) is kept only when it matches the
 *      comment's apparent concern,
 *   3. console errors are kept whenever present (a runtime error is inherently
 *      relevant),
 *   4. {@link summarizeContextSignals} is attached so the agent always SEES the
 *      full inventory and can pull everything with `get_comment` — curation is
 *      ranking-with-a-pointer, never silent hiding.
 */

export type Concern =
  | "behavioral"
  | "state"
  | "visual"
  | "a11y"
  | "perf"
  | "browser";

interface ConcernPattern {
  concern: Concern;
  regex: RegExp;
}

/**
 * Keyword signals that map a comment's free text to a concern. Overlap between
 * patterns is fine: a term hitting two concerns only broadens inclusion, which
 * is the safe direction ("relevant but enough").
 */
const CONCERN_PATTERNS: ConcernPattern[] = [
  {
    concern: "behavioral",
    regex:
      /\b(work|works|working|click|clicks|button|submit|save|saving|load|loading|fetch|request|api|endpoint|error|errors|fail|failing|failed|broken|crash|freeze|hang|stuck|spinner|unresponsive|disabled|doesn'?t|does not|doesnt|can'?t|cannot|cant|not working|nothing happens)\b/i,
  },
  {
    concern: "state",
    regex:
      /\b(login|log ?in|logout|log ?out|sign ?in|sign ?out|auth|session|token|cart|checkout|state|saved|persist|persisted|logged|account|profile|cookie|storage)\b/i,
  },
  {
    concern: "visual",
    regex:
      /\b(align|alignment|spacing|margin|padding|gap|colou?r|background|layout|position|overlap|overlapping|size|width|height|font|typography|style|styling|css|looks|appear|appears|appearance|design|pixel|responsive|too big|too small|cut ?off|clipped|truncat)\w*\b/i,
  },
  {
    concern: "a11y",
    regex:
      /\b(accessib\w*|a11y|aria|screen ?reader|contrast|alt ?text|label|focus|keyboard|tab order|wcag)\b/i,
  },
  {
    concern: "perf",
    regex:
      /\b(slow|sluggish|lag|laggy|performance|takes (too )?long|delay|delayed|janky|stutter|loading forever|never loads)\b/i,
  },
  {
    concern: "browser",
    regex:
      /\b(safari|chrome|firefox|edge|opera|ios|android|mobile|tablet|desktop|browser|device)\b/i,
  },
];

export interface CurateOptions {
  /** Comment intent ("fix" | "change" | "question"); a weak nudge. */
  intent?: string;
  /** The reviewer's note — the primary relevance signal. */
  note?: string;
}

/** Concerns inferred from a comment's note (+ intent). May be empty. */
export function detectConcerns(opts: CurateOptions): Set<Concern> {
  const text = opts.note ?? "";
  const concerns = new Set<Concern>();
  for (const { concern, regex } of CONCERN_PATTERNS) {
    if (regex.test(text)) {
      concerns.add(concern);
    }
  }
  return concerns;
}

/**
 * One-line inventory of everything captured, ALWAYS safe to attach. Lets the
 * agent know what exists (and can be pulled via `get_comment`) even when the
 * curated view omits the bulky arrays.
 */
export function summarizeContextSignals(
  context: CapturedContext | null | undefined,
): string {
  if (!context) {
    return "none";
  }
  const parts: string[] = [];
  if (context.surface) {
    const size = context.viewport
      ? ` (${context.viewport.width}×${context.viewport.height})`
      : "";
    parts.push(`surface: ${context.surface}${size}`);
  }
  if (context.react?.sourceFile) {
    parts.push(
      `source: ${context.react.sourceFile}${
        context.react.sourceLine ? `:${context.react.sourceLine}` : ""
      }`,
    );
  }
  if (context.commit) {
    parts.push(`commit: ${context.commit}`);
  }
  const consoleCount = context.consoleErrors?.length ?? 0;
  if (consoleCount > 0) {
    parts.push(`console: ${consoleCount} error(s)`);
  }
  const networkCount = context.networkRequests?.length ?? 0;
  if (networkCount > 0) {
    parts.push(`network: ${networkCount} request(s)`);
  }
  const actionCount = context.interactionTrail?.length ?? 0;
  if (actionCount > 0) {
    parts.push(`actions: ${actionCount}`);
  }
  if (context.appState) {
    const keys =
      (context.appState.localStorageKeys?.length ?? 0) +
      (context.appState.sessionStorageKeys?.length ?? 0);
    if (keys > 0) {
      parts.push(`storage: ${keys} key(s)`);
    }
  }
  const a11yCount = context.a11yTree?.length ?? 0;
  if (a11yCount > 0) {
    parts.push(`a11y: ${a11yCount} node(s)`);
  }
  if (context.screenshot) {
    parts.push("screenshot");
  }
  const referenceCount = context.referenceImages?.length ?? 0;
  if (referenceCount > 0) {
    parts.push(`reference: ${referenceCount} image(s)`);
  }
  const editCount = context.changeSet?.ops.length ?? 0;
  if (editCount > 0) {
    parts.push(`change-set: ${editCount} edit(s)`);
  }
  if (context.environment?.userAgent) {
    parts.push("environment");
  }
  return parts.length > 0 ? parts.join(" · ") : "none";
}

// ---------------------------------------------------------------------------
// Visual change-set → prose (U16, R14)
// ---------------------------------------------------------------------------

/**
 * Render a `template` comment's structured change-set as deterministic plain
 * language, e.g. "font-size 32px→48px on src/Hero.tsx:12; insert <button>
 * \"Buy\" after section#hero". Delivered ALONGSIDE the structured change-set so
 * the agent reads the intent both ways — but it is PROPOSED intent (verify
 * against source), never an instruction to apply verbatim. Returns `null` when
 * there is no change-set. Pure + dependency-free.
 */
export function summarizeChangeSet(
  context: CapturedContext | null | undefined,
): string | null {
  const ops = context?.changeSet?.ops;
  if (!ops || ops.length === 0) {
    return null;
  }
  return ops.map(describeOp).join("; ");
}

function describeOp(op: ChangeOp): string {
  return `${describeOpBody(op)}${responsiveSuffix(op)}${fontSuffix(op)}${tokenSuffix(op)}${swapProvenance(op)}${previewCaveat(op)}`;
}

/**
 * A trailing breakpoint tag (U14/U15): an edit made in device mode carries the
 * surface it applies at, so the agent scopes the change to that breakpoint rather
 * than the base rule. Empty at base ("web" / unset).
 */
function responsiveSuffix(op: ChangeOp): string {
  return op.responsive && op.responsive !== "web" ? ` @${op.responsive}` : "";
}

/**
 * A provenance caveat for a reviewer-entered media URL (U6/U15): a swap `src`/
 * `srcset` set to an absolute URL is UNVERIFIED user input, so the agent must host
 * + validate it before adopting rather than wiring the third-party URL directly.
 */
function swapProvenance(op: ChangeOp): string {
  if (op.type !== "setAttr") return "";
  const prop = (op.property ?? "").toLowerCase();
  if (prop !== "src" && prop !== "srcset") return "";
  const after = op.after ?? "";
  return /^https?:\/\//i.test(after)
    ? " (reviewer-entered URL, unverified: host + validate before adopting)"
    : "";
}

/**
 * A trailing design-token note (U11): when an edit's value matched a page CSS
 * custom property, tell the agent to change the TOKEN (`use token --brand-500`)
 * rather than hard-code the raw value. Kept out of the op body so it composes with
 * every op type. Empty when the op carries no token.
 */
function tokenSuffix(op: ChangeOp): string {
  return op.valueToken ? ` (use token ${op.valueToken})` : "";
}

/**
 * A trailing font-identity note for a `font-family` op (U7): the chosen family,
 * where it came from (page / google / upload), and its weights, so the agent
 * installs the font the repo's way rather than inferring from the raw stack.
 * Kept out of the op body so it composes with the setStyle line and the preview
 * caveat. Empty when the op carries no font identity.
 */
function fontSuffix(op: ChangeOp): string {
  const f = op.font;
  if (!f) return "";
  const parts = [f.family, f.source];
  if (f.weights && f.weights.length > 0) {
    parts.push(`weights ${f.weights.join("/")}`);
  }
  let note = ` [font ${parts.join(", ")}]`;
  // A guest-uploaded font binary is unverified user input: the agent should
  // validate the file before adopting it (the MCP delivers it as a signed ref).
  if (f.source === "upload") note += " (uploaded file, unverified: validate before adopting)";
  return note;
}

function describeOpBody(op: ChangeOp): string {
  const where = targetLabel(op.target);
  switch (op.type) {
    case "setStyle":
      return `${op.property ?? "style"} ${valuePair(op.before, op.after)} on ${where}`;
    case "setAttr":
      return `${op.property ?? "attribute"} ${valuePair(op.before, op.after)} on ${where}`;
    case "setText":
      return `text ${quotedPair(op.before, op.after)} on ${where}`;
    case "setVisibility":
      return `${op.after === "hidden" ? "hide" : "show"} ${where}`;
    case "removeNode":
      return `remove ${where}`;
    case "moveNode":
      // Requirement F: the agent must be able to act on "move X before/after Y",
      // so lead with the anchored destination neighbour, not just the indices.
      return `move ${where}${op.insertion ? insertionLabel(op.insertion) : ""}${
        op.order ? ` (position ${op.order.from}→${op.order.to})` : ""
      }`;
    case "insertNode": {
      const node = op.node
        ? `<${op.node.tag}>${op.node.text ? ` "${truncate(op.node.text)}"` : ""}`
        : "element";
      return `insert ${node}${op.insertion ? insertionLabel(op.insertion) : ""}`;
    }
    default:
      return `edit ${where}`;
  }
}

/**
 * A trailing caveat when the reviewer's page could not confirm the preview, so
 * the agent trusts the recorded intent over the screenshot (U2). Kept out of the
 * op body so it composes with every op type as new fields land.
 */
function previewCaveat(op: ChangeOp): string {
  return op.previewUnavailable ? " (preview unavailable on the reviewer's page; trust this value over the screenshot)" : "";
}

/** A short label for a target: exact source location, else selector, else anchor. */
function targetLabel(target: EditTarget): string {
  if (target.source) {
    return `${target.source.file}:${target.source.line}`;
  }
  if (target.selector) {
    return target.selector;
  }
  const anchor = target.anchors?.[0];
  return anchor ? `${anchor.type}=${anchor.value}` : "element";
}

function insertionLabel(insertion: InsertionPoint): string {
  const ref = insertion.reference ?? insertion.parent;
  const where = ref ? ` ${targetLabel(ref)}` : "";
  return ` ${insertion.position}${where}`;
}

function valuePair(before?: string | null, after?: string | null): string {
  return `${before ?? "?"}→${after ?? "?"}`;
}

function quotedPair(before?: string | null, after?: string | null): string {
  return `"${truncate(before ?? "")}"→"${truncate(after ?? "")}"`;
}

/** Cap a free-text fragment so one prose line can't blow up the payload. */
function truncate(text: string, max = 40): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Return a curated copy of `context` containing the decisive core plus only the
 * enrichment relevant to the comment. Pure — the input is not mutated. Pair with
 * {@link summarizeContextSignals} so the agent can still pull what was omitted.
 */
export function curateContextForAgent(
  context: CapturedContext | null | undefined,
  opts: CurateOptions = {},
): CapturedContext | null | undefined {
  if (!context) {
    return context;
  }
  const concerns = detectConcerns(opts);
  // A device-tagged comment (mobile/tablet/responsive) is inherently about
  // layout on a device, so treat it as visual + browser-relevant — keep styles,
  // a11y, and environment up front for the agent.
  if (context.surface && context.surface !== "web") {
    concerns.add("visual");
    concerns.add("browser");
  }
  const general = concerns.size === 0;
  const hasConsole = (context.consoleErrors?.length ?? 0) > 0;
  const hasSource = Boolean(context.react?.sourceFile);

  const curated: CapturedContext = { ...context };

  // Network: relevant to behavioural/perf/state bugs, or whenever the runtime
  // already logged an error.
  if (
    !(
      concerns.has("behavioral") ||
      concerns.has("perf") ||
      concerns.has("state") ||
      hasConsole
    )
  ) {
    delete curated.networkRequests;
  }

  // Interaction trail: the repro steps matter for behavioural/state/perf bugs.
  if (
    !(
      concerns.has("behavioral") ||
      concerns.has("state") ||
      concerns.has("perf")
    )
  ) {
    delete curated.interactionTrail;
  }

  // App state: hints at state/auth/feature-flag bugs.
  if (!(concerns.has("state") || concerns.has("behavioral"))) {
    delete curated.appState;
  }

  // Environment: only matters for browser/device-specific reports.
  if (!concerns.has("browser")) {
    delete curated.environment;
  }

  // a11y tree: relevant to visual/accessibility/structural comments, and useful
  // for code-location whenever there's no exact source line. Kept on the general
  // (unclassified) path as a sensible default.
  if (
    !(concerns.has("visual") || concerns.has("a11y") || general || !hasSource)
  ) {
    delete curated.a11yTree;
  }

  // Computed styles: matter for visual/a11y comments; dropped for purely
  // behavioural ones. Kept on the general path.
  if (!(concerns.has("visual") || concerns.has("a11y") || general)) {
    delete curated.computedStyles;
  }

  return curated;
}
