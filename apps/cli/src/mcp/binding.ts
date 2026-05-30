/**
 * Project binding — the local, developer-scoped link between this machine's
 * Claude Code session and a single SuperComment preview/project in Supabase.
 *
 * U5 (authenticated outbound channel + project binding) is responsible for
 * WRITING this file at `supercomment start`: it provisions a developer-scoped
 * Supabase access token (NOT the guest path, R25) and records which preview /
 * project the current working directory is bound to. U5 is not built yet.
 *
 * U12 (this MCP server) only DEFINES the binding shape and CONSUMES it. We keep
 * the loader injectable so the tools/store can be tested without touching the
 * real filesystem or env, and so U5 can later swap in its own writer without
 * changing this contract.
 *
 * Security (R25): the token here is loopback-local only. It is read from a file
 * the developer owns (`~/.supercomment/binding.json`) or from env. It is never
 * transmitted anywhere except to Supabase over the developer's own outbound
 * connection. Never log the token.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the binding lives by default. U5 writes this file. */
export const DEFAULT_BINDING_DIR = ".supercomment";
export const DEFAULT_BINDING_FILE = "binding.json";

/**
 * The developer-scoped local project binding. Shape is the contract between U5
 * (writer) and U12 (reader). Keep it small and explicit.
 */
export interface ProjectBinding {
  /** Supabase project URL, e.g. "https://<ref>.supabase.co". */
  supabaseUrl: string;
  /**
   * Developer-scoped Supabase access token (a member session JWT or a scoped
   * key). NOT the anonymous guest path (R25). Used as the `Authorization`
   * bearer so RLS applies the developer's member identity.
   */
  token: string;
  /** The preview this working directory is bound to (drives comment scoping). */
  previewId: string;
  /** The owning project (informational / future multi-preview scoping). */
  projectId?: string;
}

/** Narrow runtime guard so a malformed binding file fails loudly, not silently. */
function isProjectBinding(value: unknown): value is ProjectBinding {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.supabaseUrl === "string" &&
    v.supabaseUrl.length > 0 &&
    typeof v.token === "string" &&
    v.token.length > 0 &&
    typeof v.previewId === "string" &&
    v.previewId.length > 0 &&
    (v.projectId === undefined || typeof v.projectId === "string")
  );
}

/** Raised when no usable binding can be found/parsed. */
export class BindingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingNotFoundError";
  }
}

/**
 * Resolve the binding file path. Precedence:
 *   1. `SUPERCOMMENT_BINDING_PATH` env (explicit override / tests)
 *   2. `~/.supercomment/binding.json` (where U5 writes it)
 *
 * `env`/`home` are injectable for tests.
 */
export function resolveBindingPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const override = env.SUPERCOMMENT_BINDING_PATH;
  if (override && override.length > 0) return override;
  return join(home, DEFAULT_BINDING_DIR, DEFAULT_BINDING_FILE);
}

/**
 * Build a binding directly from env vars, when present. Lets a developer (or a
 * CI harness) point the MCP server at a preview without a file. All three of
 * URL/token/previewId must be present for the env path to apply.
 */
export function bindingFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProjectBinding | undefined {
  const supabaseUrl = env.SUPERCOMMENT_SUPABASE_URL;
  const token = env.SUPERCOMMENT_TOKEN;
  const previewId = env.SUPERCOMMENT_PREVIEW_ID;
  if (!supabaseUrl || !token || !previewId) return undefined;
  const projectId = env.SUPERCOMMENT_PROJECT_ID;
  return { supabaseUrl, token, previewId, ...(projectId ? { projectId } : {}) };
}

/** Injectable dependencies so tests don't touch the real fs/env/home. */
export interface LoadBindingDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Reads a file as UTF-8 text; defaults to fs/promises readFile. */
  readTextFile?: (path: string) => Promise<string>;
}

/**
 * Load the project binding. Env vars win (SUPERCOMMENT_*), otherwise read the
 * JSON file at the resolved path. Throws `BindingNotFoundError` with actionable
 * guidance if nothing usable is found — the MCP server surfaces this on stderr.
 */
export async function loadProjectBinding(
  deps: LoadBindingDeps = {},
): Promise<ProjectBinding> {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const readTextFile =
    deps.readTextFile ?? ((p: string) => readFile(p, "utf8"));

  const fromEnv = bindingFromEnv(env);
  if (fromEnv) return fromEnv;

  const path = resolveBindingPath(env, home);
  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch {
    throw new BindingNotFoundError(
      `No SuperComment project binding found. Run \`supercomment start\` to ` +
        `create ${path}, or set SUPERCOMMENT_SUPABASE_URL / SUPERCOMMENT_TOKEN ` +
        `/ SUPERCOMMENT_PREVIEW_ID.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BindingNotFoundError(
      `Project binding at ${path} is not valid JSON.`,
    );
  }

  if (!isProjectBinding(parsed)) {
    throw new BindingNotFoundError(
      `Project binding at ${path} is missing required fields ` +
        `(supabaseUrl, token, previewId).`,
    );
  }

  return parsed;
}
