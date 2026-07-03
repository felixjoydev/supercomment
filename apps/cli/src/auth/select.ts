/**
 * Review-target selection for `supercomment login` / `init`.
 *
 * After the browser handoff yields a member token, the CLI must pick WHICH
 * review link (a `previews` row, scoped to one project) the binding points at —
 * that scoping drives which comments the MCP server returns. This module mirrors
 * the dashboard's data access (listProjects / listPreviews / createProject), but
 * over the member token from the CLI side. RLS does the multi-tenant isolation:
 * every query below only ever sees the developer's own workspaces.
 *
 * The DECISION (`pickChoice`) is a pure function so auto-select / flag-match /
 * prompt branching is unit-tested without a network; the network calls wrap it.
 *
 * IA recap (post workspace refactor): workspace → project → review link. Every
 * project owns ≥1 review link (backfilled in migration 0025; created with every
 * new project). The project's FIRST review link (earliest `created_at`) is its
 * default; a legacy project with none gets one created on selection.
 */

import { asError } from "../lib/errors.js";

/** A Supabase result envelope. */
interface DbResult {
  data: unknown;
  error: unknown;
}

/**
 * Minimal structural type for the Supabase client we use, so this module stays
 * injectable for tests and carries no hard `@supabase/supabase-js` type
 * dependency. The real client (anon key + member-JWT bearer) satisfies it.
 */
interface OrderQuery {
  order(col: string, opts: { ascending: boolean }): Promise<DbResult>;
}
interface SelectQuery extends OrderQuery {
  eq(col: string, value: unknown): OrderQuery;
}
interface InsertQuery {
  select(cols: string): { single(): Promise<DbResult> };
}
interface TableQuery {
  select(cols: string): SelectQuery;
  insert(row: Record<string, unknown>): InsertQuery;
}
export interface SupabaseQuery {
  from(table: string): TableQuery;
  rpc(fn: string, args: Record<string, unknown>): Promise<DbResult>;
}

/** The resolved binding scope: one project + its default review link. */
export interface ReviewTarget {
  projectId: string;
  projectName: string;
  previewId: string;
  /** The /s/<slug> path segment (non-secret). */
  slug: string;
  /** Guest link secret, when the review link has one (else null). */
  linkSecret: string | null;
}

/** A project plus its default review link (previewId null = none yet). */
export interface ProjectChoice {
  projectId: string;
  projectName: string;
  previewId: string | null;
  slug: string | null;
  linkSecret: string | null;
}

/** Raised when the developer has no projects and creation is disabled. */
export class NoProjectsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoProjectsError";
  }
}

// --- pure selection decision ------------------------------------------------

export interface PickResult {
  choice?: ProjectChoice;
  /** Multiple choices and no flag — the caller must prompt. */
  needsPrompt?: boolean;
  /** A `--project` flag matched nothing actionable. */
  error?: string;
  /** No projects exist at all. */
  empty?: boolean;
}

/**
 * Decide which project to bind, purely. Auto-selects a sole project, matches a
 * `--project` flag by id or (case-insensitive) name, flags ambiguity for a
 * prompt, and reports emptiness so the caller can offer to create one.
 */
export function pickChoice(
  choices: ProjectChoice[],
  projectFlag?: string,
): PickResult {
  if (choices.length === 0) return { empty: true };

  if (projectFlag && projectFlag.length > 0) {
    const needle = projectFlag.toLowerCase();
    const match = choices.find(
      (c) =>
        c.projectId.toLowerCase() === needle ||
        c.projectName.toLowerCase() === needle,
    );
    if (match) return { choice: match };
    const names = choices.map((c) => `"${c.projectName}"`).join(", ");
    return {
      error: `No project matching "${projectFlag}". Available: ${names}.`,
    };
  }

  if (choices.length === 1) return { choice: choices[0]! };
  return { needsPrompt: true };
}

// --- interactive prompters (injectable; default to readline) ----------------

/** Picks one of several choices, returning the chosen index. */
export type Prompter = (opts: {
  question: string;
  choices: string[];
}) => Promise<number>;

/** Reads a free-text answer (e.g. a new project name). */
export type TextPrompter = (question: string) => Promise<string>;

/** Default index picker over a real TTY (prompts on stderr). */
export const readlinePrompter: Prompter = async ({ question, choices }) => {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    process.stderr.write(`\n${question}\n`);
    choices.forEach((c, i) => process.stderr.write(`  [${i + 1}] ${c}\n`));
    for (;;) {
      const ans = (await rl.question(`Enter 1-${choices.length}: `)).trim();
      const n = Number(ans);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
      process.stderr.write(
        `Please enter a number between 1 and ${choices.length}.\n`,
      );
    }
  } finally {
    rl.close();
  }
};

/** Default free-text prompter over a real TTY. */
export const readlineTextPrompter: TextPrompter = async (question) => {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    return (await rl.question(`${question} `)).trim();
  } finally {
    rl.close();
  }
};

// --- network reads ----------------------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
}
interface PreviewRow {
  id: string;
  slug: string;
  link_secret: string | null;
  project_id: string;
}

/**
 * Load every project the member can see, each paired with its default (earliest)
 * review link. One query for projects, one for previews — grouped client-side —
 * so this is O(2) round trips regardless of project count.
 */
export async function loadChoices(
  client: SupabaseQuery,
): Promise<ProjectChoice[]> {
  const projRes = await client
    .from("projects")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (projRes.error) throw asError(projRes.error, "Failed to list projects");
  const projects = (projRes.data ?? []) as ProjectRow[];

  const pvRes = await client
    .from("previews")
    .select("id, slug, link_secret, project_id")
    .order("created_at", { ascending: true });
  if (pvRes.error) throw asError(pvRes.error, "Failed to list review links");
  const previews = (pvRes.data ?? []) as PreviewRow[];

  // Earliest review link wins as the project default (query is asc by created_at).
  const firstByProject = new Map<string, PreviewRow>();
  for (const pv of previews) {
    if (!firstByProject.has(pv.project_id)) firstByProject.set(pv.project_id, pv);
  }

  return projects.map((p) => {
    const pv = firstByProject.get(p.id);
    return {
      projectId: p.id,
      projectName: p.name,
      previewId: pv?.id ?? null,
      slug: pv?.slug ?? null,
      linkSecret: pv?.link_secret ?? null,
    };
  });
}

// --- creation (no-project bootstrap / legacy project w/o review link) -------

/** Lowercase, URL-safe slug alphabet (mirrors apps/web/lib/slug.ts). */
const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Generate a non-secret review-link slug. Injectable for deterministic tests. */
async function generateSlug(length = 12): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  const bytes = randomBytes(length);
  let out = "rl-";
  for (let i = 0; i < length; i++) {
    out += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
  }
  return out;
}

/** Ensure the member has a workspace; create "My Workspace" if they have none. */
async function ensureWorkspaceId(client: SupabaseQuery): Promise<string> {
  const res = await client
    .from("workspaces")
    .select("id")
    .order("created_at", { ascending: true });
  if (res.error) throw asError(res.error, "Failed to list workspaces");
  const rows = (res.data ?? []) as { id: string }[];
  if (rows[0]) return rows[0].id;

  // First-workspace bootstrap goes through the SECURITY DEFINER RPC (migration
  // 0005/0024): a plain insert is blocked by RLS on the first workspace_members
  // row. Mirrors apps/web/lib/data.ts:createWorkspace.
  const created = await client.rpc("create_workspace", {
    p_name: "My Workspace",
  });
  if (created.error) throw asError(created.error, "Failed to create workspace");
  const row = created.data as { id?: string } | null;
  if (!row?.id) throw new Error("create_workspace returned no workspace id.");
  return row.id;
}

/**
 * Insert a default review link for a project and return its scope. Retries once
 * on the astronomically unlikely slug collision (23505), mirroring the web.
 */
async function ensureReviewLink(
  client: SupabaseQuery,
  projectId: string,
  deps: { genSlug?: () => Promise<string> } = {},
): Promise<{ previewId: string; slug: string; linkSecret: string | null }> {
  const genSlug = deps.genSlug ?? generateSlug;
  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = await genSlug();
    const res = await client
      .from("previews")
      .insert({
        project_id: projectId,
        name: "Review link",
        slug,
        access_mode: "team_only",
        status: "offline",
      })
      .select("id, slug, link_secret")
      .single();
    if (!res.error) {
      const row = res.data as {
        id: string;
        slug: string;
        link_secret: string | null;
      };
      return {
        previewId: row.id,
        slug: row.slug,
        linkSecret: row.link_secret,
      };
    }
    const code = (res.error as { code?: string } | null)?.code;
    if (code !== "23505") {
      throw asError(res.error, "Failed to create review link");
    }
  }
  throw new Error("Could not allocate a unique slug for the review link.");
}

/** Create a fresh project (+ its default review link) and return the target. */
export async function createProjectTarget(
  client: SupabaseQuery,
  projectName: string,
  deps: { genSlug?: () => Promise<string> } = {},
): Promise<ReviewTarget> {
  const workspaceId = await ensureWorkspaceId(client);
  const res = await client
    .from("projects")
    .insert({ workspace_id: workspaceId, name: projectName })
    .select("id, name")
    .single();
  if (res.error) throw asError(res.error, "Failed to create project");
  const project = res.data as { id: string; name: string };
  const link = await ensureReviewLink(client, project.id, deps);
  return {
    projectId: project.id,
    projectName: project.name,
    previewId: link.previewId,
    slug: link.slug,
    linkSecret: link.linkSecret,
  };
}

// --- orchestration ----------------------------------------------------------

export interface ResolveTargetOptions {
  /** `--project <id|name>` for non-interactive selection. */
  projectFlag?: string;
  /** Index picker for the multi-project case (defaults to readline on a TTY). */
  prompt?: Prompter;
  /** Free-text prompter for a new project name (defaults to readline on a TTY). */
  promptText?: TextPrompter;
  /** Whether stdin is an interactive terminal. */
  isTTY?: boolean;
  /** Human progress line sink. */
  log?: (line: string) => void;
  /** Create a project when the developer has none (default true). */
  allowCreate?: boolean;
  /** Injectable slug generator (tests). */
  genSlug?: () => Promise<string>;
}

/**
 * Resolve the single review target to bind. Auto-selects when unambiguous,
 * honors `--project`, prompts on a TTY when ambiguous, creates a project/review
 * link when needed, and throws actionable guidance when it can't decide
 * non-interactively.
 */
export async function resolveTarget(
  client: SupabaseQuery,
  opts: ResolveTargetOptions = {},
): Promise<ReviewTarget> {
  const log = opts.log ?? (() => undefined);
  const allowCreate = opts.allowCreate ?? true;
  const choices = await loadChoices(client);
  const pick = pickChoice(choices, opts.projectFlag);

  if (pick.error) throw new Error(pick.error);

  if (pick.empty) {
    if (!allowCreate) {
      throw new NoProjectsError(
        "No projects found. Create one in the dashboard, then re-run.",
      );
    }
    const name =
      opts.isTTY && opts.promptText
        ? (await opts.promptText(
            "No project yet — name for a new project:",
          )) || "My Project"
        : null;
    if (!name) {
      throw new NoProjectsError(
        "No projects found. Create one in the dashboard, or run `supercomment " +
          "login` from a terminal to create one interactively.",
      );
    }
    log(`Creating project "${name}"…`);
    return createProjectTarget(client, name, { genSlug: opts.genSlug });
  }

  let choice = pick.choice;
  if (pick.needsPrompt) {
    if (!opts.prompt || !opts.isTTY) {
      const names = choices.map((c) => `"${c.projectName}"`).join(", ");
      throw new Error(
        `Multiple projects — pass --project <name|id>. Available: ${names}.`,
      );
    }
    const idx = await opts.prompt({
      question: "Which project should the AI agent read comments from?",
      choices: choices.map(
        (c) =>
          `${c.projectName}${c.slug ? `  (review link ${c.slug})` : "  (no review link yet)"}`,
      ),
    });
    choice = choices[idx];
    if (!choice) throw new Error("Invalid project selection.");
  }

  if (!choice) throw new Error("No project selected.");

  // A (legacy) project without a review link gets one created on selection.
  if (!choice.previewId || !choice.slug) {
    log(`Creating a review link for "${choice.projectName}"…`);
    const link = await ensureReviewLink(client, choice.projectId, {
      genSlug: opts.genSlug,
    });
    return {
      projectId: choice.projectId,
      projectName: choice.projectName,
      previewId: link.previewId,
      slug: link.slug,
      linkSecret: link.linkSecret,
    };
  }

  return {
    projectId: choice.projectId,
    projectName: choice.projectName,
    previewId: choice.previewId,
    slug: choice.slug,
    linkSecret: choice.linkSecret,
  };
}
