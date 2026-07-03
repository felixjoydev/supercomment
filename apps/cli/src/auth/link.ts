/**
 * `supercomment link` — bind the CURRENT repo to a SuperComment project by
 * writing `supercomment.json` at the repo root. Reuses the global credentials
 * (from `supercomment login`); only the per-repo project/preview selection is
 * recorded here, so different repos read different projects without re-logging-in
 * and without a global switch.
 *
 * Selection order: `--project <name|id>` → auto-detect (match the repo's folder /
 * git-remote name against your project names) → interactive prompt (TTY) →
 * create a project (handled by resolveTarget). The written file carries no
 * secrets and is meant to be COMMITTED.
 */
import { loadProjectBinding, type ProjectBinding } from "../config/binding.js";
import { assertAllowedSupabaseUrl } from "../config/supabase-url.js";
import {
  matchProjectByName,
  writeRepoLink,
  type RepoLink,
} from "../config/repo-link.js";
import {
  loadChoices,
  readlinePrompter,
  readlineTextPrompter,
  resolveTarget,
  type Prompter,
  type ReviewTarget,
  type SupabaseQuery,
  type TextPrompter,
} from "./select.js";
import { errorMessage } from "../lib/errors.js";
import { makeMemberClient } from "../supabase/client.js";

/** Build a member-scoped Supabase client from the stored binding. */
async function defaultMakeClient(
  binding: ProjectBinding,
): Promise<SupabaseQuery> {
  const anonKey = binding.anonKey ?? process.env.SUPERCOMMENT_ANON_KEY;
  if (!anonKey) {
    throw new Error(
      "Binding has no anon key. Run `supercomment login` to refresh it.",
    );
  }
  return makeMemberClient<SupabaseQuery>(
    binding.supabaseUrl,
    anonKey,
    binding.token,
  );
}

/** Repo name hints for auto-detect: the folder name + the git-remote repo name. */
async function defaultRepoHints(cwd: string): Promise<string[]> {
  const { basename } = await import("node:path");
  const hints = [basename(cwd)];
  try {
    const { execFile } = await import("node:child_process");
    const url = await new Promise<string>((resolve) => {
      execFile(
        "git",
        ["-C", cwd, "config", "--get", "remote.origin.url"],
        (err, stdout) => resolve(err ? "" : stdout.trim()),
      );
    });
    const m = url.replace(/\.git$/, "").match(/([^/:]+)$/);
    if (m?.[1]) hints.push(m[1]);
  } catch {
    // no git / no remote — folder name is enough
  }
  return hints.filter((h) => h.length > 0);
}

export interface RunLinkOptions {
  projectFlag?: string;
  cwd?: string;
  // --- injectable collaborators (tests) ---
  loadBinding?: () => Promise<ProjectBinding>;
  makeClient?: (binding: ProjectBinding) => Promise<SupabaseQuery>;
  repoHints?: (cwd: string) => Promise<string[]>;
  writeLink?: (dir: string, link: RepoLink) => Promise<string>;
  prompt?: Prompter;
  promptText?: TextPrompter;
  isTTY?: boolean;
  log?: (line: string) => void;
}

export interface LinkResult {
  path: string;
  target: ReviewTarget;
}

export async function runLink(opts: RunLinkOptions = {}): Promise<LinkResult> {
  const log = opts.log ?? ((l: string) => process.stdout.write(l + "\n"));
  const cwd = opts.cwd ?? process.cwd();
  const loadBinding = opts.loadBinding ?? (() => loadProjectBinding());
  const makeClient = opts.makeClient ?? defaultMakeClient;
  const repoHints = opts.repoHints ?? defaultRepoHints;
  const writeLink = opts.writeLink ?? ((d, l) => writeRepoLink(d, l));
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY);
  const prompt = opts.prompt ?? readlinePrompter;
  const promptText = opts.promptText ?? readlineTextPrompter;

  let binding: ProjectBinding;
  try {
    binding = await loadBinding();
  } catch (err) {
    throw new Error(
      `Not logged in (${
        errorMessage(err)
      }). Run \`supercomment login\` first.`,
    );
  }

  assertAllowedSupabaseUrl(binding.supabaseUrl);
  const client = await makeClient(binding);

  // Auto-detect: if no explicit flag, try to match this repo's name to a project.
  let projectFlag = opts.projectFlag;
  if (!projectFlag) {
    try {
      const [hints, choices] = await Promise.all([
        repoHints(cwd),
        loadChoices(client),
      ]);
      const match = matchProjectByName(hints, choices);
      if (match) {
        projectFlag = match.projectId;
        log(`Auto-detected project "${match.projectName}" from this repo.`);
      }
    } catch {
      // best-effort — fall through to flag/prompt
    }
  }

  const target = await resolveTarget(client, {
    ...(projectFlag ? { projectFlag } : {}),
    prompt,
    promptText,
    isTTY,
    log,
  });

  const path = await writeLink(cwd, {
    previewId: target.previewId,
    projectId: target.projectId,
    project: target.projectName,
    slug: target.slug,
  });

  log("");
  log(`✔ Linked this repo to "${target.projectName}" (review link ${target.slug}).`);
  log(`  Wrote ${path} — commit it so teammates' agents read the same project.`);
  log("Restart Claude Code (or run /mcp) to pick up the change.");

  return { path, target };
}
